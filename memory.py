import json, os, time, hashlib
from pathlib import Path
from typing import List, Dict, Optional, Any

DATA_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'renderer', 'data'))

class Checkpointer:
    def __init__(self, db_path: str = None):
        self._db = db_path or os.path.join(DATA_DIR, 'langgraph_checkpoints.json')
        self._checkpoints: Dict[str, Any] = {}
        self._load()

    def _load(self):
        if os.path.exists(self._db):
            try:
                with open(self._db, 'r', encoding='utf-8') as f:
                    self._checkpoints = json.load(f)
            except:
                self._checkpoints = {}

    def _save(self):
        d = os.path.dirname(self._db)
        if d and not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(self._db, 'w', encoding='utf-8') as f:
            json.dump(self._checkpoints, f, indent=2, ensure_ascii=False)

    def save(self, session_id: str, state: dict):
        self._checkpoints[session_id] = {
            "state": state,
            "timestamp": time.time(),
        }
        self._save()

    def load(self, session_id: str) -> Optional[dict]:
        cp = self._checkpoints.get(session_id)
        if cp:
            return cp.get("state")
        return None

    def list_sessions(self) -> List[Dict]:
        return [
            {"session_id": k, "timestamp": v["timestamp"], "msg_count": len(v.get("state", {}).get("messages", []))}
            for k, v in self._checkpoints.items()
        ]

    def delete(self, session_id: str):
        self._checkpoints.pop(session_id, None)
        self._save()


class ConversationMemory:
    def __init__(self, max_messages: int = 100, summary_window: int = 20):
        self.max_messages = max_messages
        self.summary_window = summary_window

    def add_messages(self, messages: List[dict], new_msgs: List[dict]) -> List[dict]:
        combined = messages + new_msgs
        if len(combined) <= self.max_messages:
            return combined
        head = combined[:self.summary_window]
        tail = combined[-(self.max_messages - self.summary_window):]
        summary_text = "Previously: " + "; ".join(
            f"{m.get('role','?')}: {m.get('content','')[:80]}"
            for m in head
        )
        summary_msg = {"role": "system", "content": f"[MEMORY SUMMARY] {summary_text}"}
        return [summary_msg] + tail


class VectorStore:
    def __init__(self, db_path: str = None):
        self._db = db_path or os.path.join(DATA_DIR, 'langgraph_rag.json')
        self._docs: List[Dict] = []
        self._embeddings: List[List[float]] = []
        self._load()

    def _load(self):
        if os.path.exists(self._db):
            try:
                with open(self._db, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self._docs = data.get("docs", [])
                    self._embeddings = data.get("embeddings", [])
            except:
                pass

    def _save(self):
        d = os.path.dirname(self._db)
        if d and not os.path.exists(d):
            os.makedirs(d, exist_ok=True)
        with open(self._db, 'w', encoding='utf-8') as f:
            json.dump({"docs": self._docs, "embeddings": self._embeddings}, f, ensure_ascii=False)

    def _simple_embed(self, text: str) -> List[float]:
        vec = [0.0] * 128
        for i, ch in enumerate(text):
            vec[i % 128] += ord(ch) * 0.01
        norm = sum(v*v for v in vec)**0.5
        if norm > 0:
            vec = [v/norm for v in vec]
        return vec

    def add_document(self, content: str, metadata: dict = None):
        self._docs.append({"content": content, "metadata": metadata or {}})
        self._embeddings.append(self._simple_embed(content))

    def add_texts(self, texts: List[str], metadatas: List[dict] = None):
        for i, t in enumerate(texts):
            md = metadatas[i] if metadatas else {}
            self.add_document(t, md)
        self._save()

    def similarity_search(self, query: str, k: int = 5) -> List[Dict]:
        if not self._docs:
            return []
        qv = self._simple_embed(query)
        scored = []
        for i, ev in enumerate(self._embeddings):
            dot = sum(a*b for a,b in zip(qv, ev))
            scored.append((dot, i))
        scored.sort(reverse=True)
        results = []
        for score, idx in scored[:k]:
            results.append({
                "content": self._docs[idx]["content"],
                "metadata": self._docs[idx]["metadata"],
                "score": round(score, 4),
            })
        return results

    def count(self) -> int:
        return len(self._docs)

memory = ConversationMemory()
vector_store = VectorStore()
checkpointer = Checkpointer()
