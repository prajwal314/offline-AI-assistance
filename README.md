# AI Offline Knowledge Assistant

A local-first document Q&A and knowledge-base app built with React, Express, SQLite, Chroma, and Ollama. Users can upload PDFs, ask questions offline, and optionally expand the knowledge base with internet research without breaking the local answer flow.

## Overview

This project allows you to:

- upload PDF documents
- extract and clean document text
- chunk content and generate embeddings locally
- store embeddings in Chroma
- ask grounded questions using local retrieval + Ollama
- optionally run internet research to build additional knowledge sources
- keep the regular Q&A flow local/offline even when research mode is enabled

## Architecture at a glance

```text
Browser (React/Vite)
  -> Express API (Node)
     -> SQLite (documents + chat history)
     -> Chroma (vector embeddings)
     -> Ollama (LLM + embeddings)
     -> optional web research sources
```

## Prerequisites

- Node.js 20+ or 24+ recommended
- Python 3.13+
- Ollama installed and running
- Chroma installed and running
- Git installed

Check versions:

```powershell
node -v
python --version
ollama --version
chroma --version
```

## 1) Install dependencies

From the project root:

```powershell
npm --prefix server install
npm --prefix client install
python -m pip install chromadb
```

## 2) Start Ollama

```powershell
ollama serve
```

In a second terminal:

```powershell
ollama pull qwen3:4b
ollama pull qwen3-embedding:0.6b
ollama list
```

## 3) Start Chroma

From the project root:

```powershell
chroma run --path "E:\Project\final tear\chroma_data" --port 8000
```

If the folder path is different on your machine, use your own project path instead.

## 4) Configure environment

Create a file at `server/.env` with:

```env
PORT=5000
OLLAMA_URL=http://localhost:11434
EMBEDDING_MODEL=qwen3-embedding:0.6b
LLM_MODEL=qwen3:4b
CHROMA_URL=http://localhost:8000
CHROMA_COLLECTION=knowledge_base
```

## 5) Run the project

Start the backend:

```powershell
Set-Location "E:\Project\final tear\server"
npm start
```

Start the frontend in another terminal:

```powershell
Set-Location "E:\Project\final tear\client"
npm run dev -- --host 0.0.0.0
```

Open:

- http://localhost:5173
- API: http://localhost:5000

## 6) Verify everything is working

```powershell
curl http://localhost:5000/api/health/all
curl http://localhost:5000/api/health/chromadb
curl http://localhost:5000/api/health/ollama
```

Expected result includes:

```json
{"backend":true,"sqlite":true,"chromadb":true,"ollama":true}
```

## 7) Use the app

### Offline PDF workflow

1. Upload a PDF from the Documents panel.
2. Wait for the document to become ready.
3. Ask a question in the chat panel.
4. The app retrieves relevant chunks from the local knowledge base and answers using Ollama.

### Research workflow

1. Click “Search Internet & Build Knowledge Base”.
2. The app identifies topics and searches public sources.
3. It fetches and chunks the research content.
4. New web-based sources are added to the vector store.
5. Normal Q&A remains local/offline; internet is only used during the build phase.

## Build for production

```powershell
Set-Location "E:\Project\final tear\client"
npm run build
```

## Project structure

```text
.
├── client/
│   ├── src/
│   ├── package.json
│   └── vite.config.js
├── server/
│   ├── src/
│   ├── uploads/
│   ├── data.db
│   ├── evaluation/
│   └── package.json
├── chroma_data/
├── docs/
├── README.md
└── package.json
```

## API summary

- `POST /api/documents/upload` — upload a PDF
- `GET /api/documents` — list documents
- `GET /api/documents/:id` — get a document
- `DELETE /api/documents/:id` — delete a document
- `POST /api/chat` — ask a question
- `GET /api/chat/history` — chat history
- `GET /api/chat/stats` — document and chunk stats
- `POST /api/knowledge-base/build` — build knowledge base from research sources
- `GET /api/knowledge-base/status` — current research status
- `GET /api/health/all` — service health check

## Troubleshooting

### PowerShell path issue

If the project folder has spaces in the name, use quoted paths:

```powershell
Set-Location "E:\Project\final tear"
```

### Port already in use

Check which process owns the port:

```powershell
Get-NetTCPConnection -LocalPort 5000,8000 -ErrorAction SilentlyContinue
```

If stale processes remain, stop them and restart the services.

### Chroma unavailable

Confirm Chroma is running:

```powershell
chroma run --path "E:\Project\final tear\chroma_data" --port 8000
```

### Ollama unavailable

Confirm the model is installed:

```powershell
ollama list
```

## Notes

- `better-sqlite3` must be compatible with the Node version in use.
- The app is intentionally local-first and privacy-minded.
- Web research is optional and should not block the primary offline Q&A experience.
- The project is designed to work without a cloud AI service or external database.
