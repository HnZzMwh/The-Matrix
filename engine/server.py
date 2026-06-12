import sys, os, json, asyncio, time
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from graph import run_agent, build_graph
from memory import memory, vector_store, checkpointer

app = FastAPI(title="MATRIX LangGraph Engine", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class RunRequest(BaseModel):
    agent_id: str
    message: str
    history: List[Dict] = []
    sender_name: str = "User"
    session_id: Optional[str] = None

class MemoryStoreRequest(BaseModel):
    content: str
    metadata: Dict = {}

class MemoryQueryRequest(BaseModel):
    query: str
    k: int = 5

class CheckpointSaveRequest(BaseModel):
    session_id: str
    state: Dict

@app.get("/lg/health")
def health():
    return {"status": "ok", "engine": "langgraph"}

@app.post("/lg/run")
def run(request: RunRequest):
    result = run_agent(
        agent_id=request.agent_id,
        message=request.message,
        history=request.history,
        sender_name=request.sender_name,
        session_id=request.session_id or request.agent_id,
    )
    return result

@app.websocket("/lg/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            data = await ws.receive_json()
            action = data.get("action", "run")
            if action == "run":
                result = run_agent(
                    agent_id=data.get("agent_id"),
                    message=data.get("message"),
                    history=data.get("history", []),
                    sender_name=data.get("sender_name", "User"),
                    session_id=data.get("session_id"),
                )
                await ws.send_json({"type": "result", **result})
            elif action == "memory_store":
                vector_store.add_document(data.get("content", ""), data.get("metadata"))
                await ws.send_json({"type": "memory_stored"})
            elif action == "memory_query":
                results = vector_store.similarity_search(data.get("query", ""), data.get("k", 5))
                await ws.send_json({"type": "memory_results", "results": results})
            elif action == "checkpoint_load":
                state = checkpointer.load(data.get("session_id", ""))
                await ws.send_json({"type": "checkpoint", "state": state})
            elif action == "checkpoint_save":
                checkpointer.save(data.get("session_id", ""), data.get("state", {}))
                await ws.send_json({"type": "checkpoint_saved"})
            elif action == "sessions_list":
                sessions = checkpointer.list_sessions()
                await ws.send_json({"type": "sessions_list", "sessions": sessions})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws.send_json({"type": "error", "error": str(e)})
        except:
            pass

@app.get("/lg/memory/query")
def query_memory(q: str, k: int = 5):
    results = vector_store.similarity_search(q, k)
    return {"results": results}

@app.post("/lg/memory/store")
def store_memory(req: MemoryStoreRequest):
    vector_store.add_document(req.content, req.metadata)
    return {"success": True, "count": vector_store.count()}

@app.get("/lg/memory/count")
def memory_count():
    return {"count": vector_store.count()}

@app.get("/lg/sessions")
def list_sessions():
    return {"sessions": checkpointer.list_sessions()}

@app.get("/lg/agents")
def list_agents():
    ag_path = os.path.join(os.path.dirname(__file__), '..', 'renderer', 'data', 'agents.json')
    if os.path.exists(ag_path):
        try:
            with open(ag_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            pass
    return []

if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"[LangGraph Engine] Starting on port {port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
