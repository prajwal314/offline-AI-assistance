# AI Offline Knowledge Assistant

Offline RAG: React + Vite + Tailwind, Express 5000 + SQLite (better-sqlite3 13.0.3), Chroma (cosine/HNSW), Ollama qwen3:4b + qwen3-embedding:0.6b (1024-dim), pdf-parse.

## Prerequisites
- Node 24.x (`node -v`)
- Python 3.13 + pip (`pip --version`)
- Ollama https://ollama.com

## 1) Install dependencies
```bash
npm --prefix server install
npm --prefix client install
pip install chromadb
```

## 2) Ollama — pull models & run
```bash
ollama serve
# new terminal:
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
ollama list
curl http://localhost:11434/api/tags
```

## 3) Chroma — run vector DB
```bash
chroma run --path ./server/chroma_data --port 8000
# Windows binary example: C:/Users/diwna/AppData/Roaming/Python/Python313/Scripts/chroma.exe run --path ./server/chroma_data --port 8000
curl http://localhost:8000/api/v1/heartbeat
# run chroma locally
chroma run --host localhost --port 8000 --path "E:\Project\final tear\chroma_data"
```

## 4) Env (optional)
Create `server/.env`:
```
PORT=5000
OLLAMA_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b
LLM_MODEL=qwen3:4b
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=knowledge_base
```

## 5) Run
```bash
npm --prefix server run dev   # http://localhost:5000  health: /api/health
npm --prefix client run dev   # http://localhost:5173
# build: npm --prefix client run build
```

Start order: Ollama (11434) → Chroma (8000) → Server (5000) → Client (5173).

## 6) Verify (7 tests)
```bash
curl http://localhost:5000/api/health
curl http://localhost:5000/api/documents
curl http://localhost:5000/api/chat/stats
# upload
curl -F "file=@dummy.pdf" http://localhost:5000/api/documents/upload
# chat
curl -X POST http://localhost:5000/api/chat -H "Content-Type: application/json" -d "{\"question\":\"what is in the pdf?\"}"
curl http://localhost:5000/api/chat/history
# delete
curl -X DELETE http://localhost:5000/api/documents/1
```

## API
- `POST /api/documents/upload` PDF 20MB max → extract→chunk 600/100→embed→Chroma→status ready/failed
- `GET /api/documents` , `GET /api/documents/:id` , `DELETE /api/documents/:id` (deletes SQLite+file+Chroma)
- `POST /api/chat` `{"question","topK":5}` → `{answer,sources}` + saves chat_history
- `GET /api/chat/history` `GET /api/chat/stats` `GET /api/health`

## Notes
- better-sqlite3 must be >=13 for Node24.
- No LangChain/Docker/Pinecone; Chroma server is only Python exception; keep offline.
- Data: `server/data.db` (documents + chat_history), `server/chroma_data/`, `server/uploads/`.
