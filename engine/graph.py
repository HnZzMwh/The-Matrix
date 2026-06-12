import json, os, re, time, traceback
from typing import TypedDict, List, Dict, Optional, Any, Annotated, Literal
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

from tools import (
    parse_tool_calls, execute_tool, TOOL_DESCRIPTIONS
)
from memory import memory, vector_store, checkpointer

CONFIG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'renderer', 'data'))

def _load_agents() -> List[Dict]:
    ap = os.path.join(CONFIG_DIR, 'agents.json')
    if os.path.exists(ap):
        try:
            with open(ap, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return []
    return []

class AgentState(TypedDict):
    messages: Annotated[List[Dict], lambda a, b: a + b]
    current_agent: str
    sender_name: str
    depth: int
    agent_result: str
    tool_results: List[str]
    error: Optional[str]

def _build_system_prompt(agent: Dict, available_agents: List[Dict]) -> str:
    others = [a for a in available_agents if a.get('id') != agent.get('id')]
    names = ', '.join(a.get('name', '?') for a in others)
    tool_descs = '\n'.join(TOOL_DESCRIPTIONS.values())
    prompt = agent.get('prompt', 'You are a helpful AI agent.')
    prompt += f"""

## Collaboration
You can delegate subtasks to other agents by writing @AgentName: instruction.
Available agents: {names or 'none'}

## Tool System
Use tools when needed. Syntax: [TOOL: tool_name key="value"]
Available tools:
{tool_descs}
Example: [TOOL: read_file path="src/index.js"]
You can call multiple tools in one response."""
    return prompt

def _call_llm(messages: List[Dict], system_prompt: str) -> str:
    api_config_path = os.path.join(CONFIG_DIR, 'api_config.json')
    config = {}
    if os.path.exists(api_config_path):
        try:
            with open(api_config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
        except:
            pass

    provider = config.get('llmProvider', 'custom')
    api_key = config.get('llmCustomKey', '') or config.get('apiKey', '')
    base_url = (config.get('llmCustomUrl', '') or config.get('baseUrl', '')).rstrip('/')
    model = config.get('llmCustomModel', '') or config.get('model', 'qwen3.7-max')

    conv = [{"role": "system", "content": system_prompt}]
    for m in messages:
        role = "user" if m.get("role") in ("user", "tool") else "assistant"
        conv.append({"role": role, "content": m.get("content", m.get("text", ""))})

    if provider == 'custom' and 'bailian' in base_url.lower():
        return _call_openai_compatible(base_url, api_key, model, conv)
    elif api_key.startswith('sk-') and 'openai' in base_url:
        return _call_openai_compatible(base_url, api_key, model, conv)
    else:
        return _call_openai_compatible(base_url or "https://dashscope.aliyuncs.com/compatible-mode/v1", api_key, model, conv)

def _call_openai_compatible(base_url: str, api_key: str, model: str, messages: List[Dict]) -> str:
    import urllib.request, urllib.error
    url = f"{base_url.rstrip('/')}/chat/completions"
    body = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": 8192,
    }).encode()
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Bearer {api_key}')
    try:
        resp = urllib.request.urlopen(req, timeout=120)
        data = json.loads(resp.read().decode())
        return data['choices'][0]['message']['content']
    except urllib.error.HTTPError as e:
        err_body = e.read().decode()[:500]
        raise RuntimeError(f"LLM API error {e.code}: {err_body}")
    except Exception as e:
        raise RuntimeError(f"LLM call failed: {e}")

def agent_node(state: AgentState) -> AgentState:
    agents = _load_agents()
    agent = next((a for a in agents if a.get('id') == state['current_agent']), None)
    if not agent:
        state['error'] = f"Agent '{state['current_agent']}' not found"
        state['agent_result'] = ''
        return state

    available = _load_agents()
    system_prompt = _build_system_prompt(agent, available)

    if state.get('rag_context'):
        system_prompt += f"\n\n## Retrieved Context\n{state['rag_context']}"

    msgs = state.get('messages', [])
    try:
        reply = _call_llm(msgs, system_prompt)
        state['agent_result'] = reply
        state['messages'].append({"role": "assistant", "content": reply})
    except Exception as e:
        state['error'] = str(e)
        state['agent_result'] = f"Error: {e}"

    return state

def tool_node(state: AgentState) -> AgentState:
    text = state.get('agent_result', '')
    calls = parse_tool_calls(text)
    results = []
    for tc in calls:
        result = execute_tool(tc['name'], tc['args'])
        results.append(result)
    state['tool_results'] = results
    for r in results:
        state['messages'].append({"role": "tool", "content": r})
    return state

def has_tools(state: AgentState) -> Literal["tools", "end"]:
    calls = parse_tool_calls(state.get('agent_result', ''))
    return "tools" if calls else "end"

def has_mentions(state: AgentState) -> Literal["end"]:
    return "end"

def route_node(state: AgentState) -> AgentState:
    return state

def build_graph() -> StateGraph:
    graph = StateGraph(AgentState)

    graph.add_node("agent", agent_node)
    graph.add_node("tools", tool_node)

    graph.add_conditional_edges(
        "agent",
        has_tools,
        {"tools": "tools", "end": END}
    )
    graph.add_edge("tools", "agent")

    graph.set_entry_point("agent")
    return graph.compile(checkpointer=MemorySaver())

def run_agent(
    agent_id: str,
    message: str,
    history: List[Dict],
    sender_name: str = "User",
    session_id: str = None
) -> Dict:
    graph = build_graph()
    agents = _load_agents()
    agent = next((a for a in agents if a.get('id') == agent_id), None)
    if not agent:
        return {"error": f"Agent '{agent_id}' not found", "text": ""}

    rag_context = ""
    try:
        results = vector_store.similarity_search(message, k=3)
        if results:
            rag_context = "\n".join(r["content"] for r in results)
    except:
        pass

    initial_messages = list(history)
    initial_messages.append({"role": "user", "content": message})
    initial_state = {
        "messages": initial_messages,
        "current_agent": agent_id,
        "sender_name": sender_name,
        "depth": 0,
        "agent_result": "",
        "tool_results": [],
        "error": None,
        "rag_context": rag_context,
    }

    config = {"configurable": {"thread_id": session_id or agent_id}}
    try:
        result = graph.invoke(initial_state, config)
        final_text = result.get("agent_result", "")
        mentions = re.findall(r'@(\w+)', final_text)
        agent_names = [a.get('name', '').lower() for a in agents]
        valid_mentions = [m for m in mentions if m.lower() in agent_names]
        error = result.get("error")

        try:
            for m in initial_messages:
                if m.get("role") == "user":
                    vector_store.add_document(m.get("content", ""), {"agent": agent_id})
        except:
            pass

        return {
            "text": final_text,
            "mentions": valid_mentions,
            "error": error,
        }
    except Exception as e:
        return {"text": f"...System disturbance. {e}", "error": str(e), "mentions": []}
