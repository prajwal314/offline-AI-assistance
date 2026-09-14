# AI Offline Knowledge Assistant

Offline RAG — chat with PDFs + web research. 100% local Q&A (no internet after build).

```
PDFs ─┐
      ├─► ChromaDB (cosine/HNSW) ─► Top-K ─► Qwen3 ─► Answer + Sources
Web ──┘         ▲                    (3/5/8/10, threshold, metadata filter)
             Ollama (qwen3:4b + qwen3-embedding:0.6b) + SQLite + Express + React/Vite
```

**Tech:** React+Vite+Tailwind, Express, SQLite (better-sqlite3), ChromaDB, Ollama, pdf-parse. No LangChain/Redis/Docker required (Chroma is the only Python piece).

## Prerequisites
- Node 20+ (`node -v`), Python 3.10+ (`pip --version`), Ollama https://ollama.com

## Run from scratch

**1. Install**
```bash
npm --prefix server install
npm --prefix client install
pip install chromadb
```

**2. Ollama**
```bash
ollama serve
# new terminal:
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
curl http://localhost:11434/api/tags
```

**3. Chroma**
```bash
chroma run --path ./server/chroma_data --port 8000 --host localhost
# Docker alt: docker run -d -p 8000:8000 -v "%cd%\server\chroma_data:/chroma/chroma" chromadb/chroma
curl http://localhost:8000/api/v2/heartbeat
```

**4. Env** `server/.env` (already present):
```
PORT=5000
OLLAMA_URL=http://localhost:11434
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=knowledge_base
LLM_MODEL=qwen3:4b
EMBEDDING_MODEL=qwen3-embedding:0.6b
```

**5. Start (order matters: Ollama → Chroma → Server → Client)**
```bash
npm --prefix server run dev   # http://localhost:5000
npm --prefix client run dev   # http://localhost:5173
# build: npm --prefix client run build
```
If Chroma shows `✕ Unavailable`, restart server after Chroma is up: `curl http://localhost:5000/api/health/chromadb` should be `{"available":true}`.

**6. Verify**
```bash
curl http://localhost:5000/api/health/all
curl -F "file=@dummy.pdf" http://localhost:5000/api/documents/upload
curl -X POST http://localhost:5000/api/chat -H "Content-Type: application/json" -d "{\"question\":\"what is in the pdf?\",\"topK\":5}"
```

## API
- `POST /api/documents/upload` (PDF ≤20MB) → chunk 600/100 → embed → Chroma
- `GET /api/documents` / `DELETE /api/documents/:id`
- `POST /api/chat {question, topK, threshold, filter:{sourceType,documentId}}` → `{answer, sources:[{type,filename/page|title/url}]}`
- `GET /api/health/{all,ollama,chromadb}` `GET /api/chat/stats|history`

Data: `server/data.db` + `server/chroma_data/` + `server/uploads/`. Evaluation: `server/evaluation/`.
