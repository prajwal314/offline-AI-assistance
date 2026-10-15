# RAG System Architectural Inspection & Environment Audit

**Evaluation Date**: October 15, 2026  
**Git Commit**: `670c907cab47b00c082f7c4ba2943b02a907e938`  
**Application Title**: AI Knowledge Assistant — Offline RAG Knowledge Platform  
**Target Environment**: Windows 11 x64, Node.js v24.13.0, Ollama Local Server, ChromaDB v2 Local Vector DB  

---

## 1. System Architecture Overview

The system is a full-stack, enterprise-grade offline Retrieval-Augmented Generation (RAG) platform featuring **Adaptive Multi-Dimensional Evidence Scoring**:

```
+--------------------------------------------------------------------------+
|                            USER INTERFACE                                |
|  React 18.3 + Vite 5.4 + Tailwind CSS + Lucide React                      |
|  - Real-time SSE / NDJSON chat streaming                                 |
|  - Document Management & Indexing UI                                     |
|  - Live Health & System Status Bar                                       |
|  - Internet Research & Knowledge Base Expansion Interface                |
+-------------------------------------+------------------------------------+
                                      | HTTP REST & Streaming
+-------------------------------------v------------------------------------+
|                         EXPRESS BACKEND (Node.js)                        |
|  - Server entry: src/server.js (Port 5000)                               |
|  - Controllers: chat, documents, evaluation, knowledgeBase               |
|  - SQLite 3 (better-sqlite3): chat_sessions, history, documents, eval   |
+-------------------------------------+------------------------------------+
                                      |
         +----------------------------+----------------------------+
         |                                                         |
+--------v----------------------+                        +---------v--------+
|   HYBRID RETRIEVAL PIPELINE   |                        |   LOCAL LLM      |
|  - Dense: ChromaDB (HNSW)     |                        |   Ollama Server  |
|  - Sparse: BM25 (Inverted)    |                        |   qwen3:4b       |
|  - Fusion: RRF (k=60)         |                        |   Temp: 0.4      |
|  - Reranker: Cross-Encoder    |                        |   NumPredict:2048|
|  - Multi-Dimensional Scorer   |                        +------------------+
|  - Evidence Assembly Engine   |
+-------------------------------+
```

---

## 2. Ingestion & Document Pipeline

- **PDF Parsing**: `pdf-parse` (v2.4.5) extracting text page-by-page.
- **Chunking Strategy**: 
  - Implementation: `server/src/services/chunkingService.js`
  - Default chunk size: 600 words
  - Overlap: 100 words
  - Splitting: Sentence-boundary regex `/(?<=[.!?])\s+/`
  - Granularity: Page-level awareness (`pageNumber` mapped directly to chunks)
- **Metadata Extraction**:
  - `server/src/metadata/metadataExtractor.js`
  - Dimensions extracted: Document ID, filename, chunkIndex, pageNumber, sectionTitle, authorityScore, informationDensity.

---

## 3. Embedding Model & Vector Database

- **Embedding Model**: `qwen3-embedding:0.6b` (served locally via Ollama HTTP API `/api/embeddings`).
  - Output dimensionality: 1024 / normalized vector representations.
- **Vector Database**: `ChromaDB` (v1.8.0 client connecting to local server at `http://localhost:8000`).
  - Collection: `knowledge_base`
  - Distance metric: Cosine / L2 distance.
  - Active document: `NIST.AI.100-1.pdf` (Artificial Intelligence Risk Management Framework 1.0)
  - Active chunk count: 48 chunks spanning 48 document pages.

---

## 4. Retrieval & Ranking Engine

The retriever implements five distinct experimental configurations:

| Method ID | Retrieval Mode | Pipeline Description |
|-----------|----------------|----------------------|
| **Method A** | `dense` | Pure vector search via ChromaDB embeddings |
| **Method B** | `hybrid` | Dense + Sparse (BM25) fused with Reciprocal Rank Fusion (RRF, $k=60$) |
| **Method C** | `hybrid_rerank` | Hybrid RRF pool ($N=20$) re-ranked by lexical/cross-encoder reranker |
| **Method D** | `hybrid_rerank_meta` | Hybrid + Reranker + Fixed-weight Multi-Dimensional scoring |
| **Method E** | `adaptive` | Hybrid + Reranker + Query-Intent Dynamic Weighting + Evidence Assembly |

### Multi-Dimensional Scoring Dimensions:
1. **Semantic Similarity** ($S_{dense}$): Dense vector embedding similarity.
2. **Lexical Match** ($S_{lexical}$): Exact keyword and token overlap ratio.
3. **Rerank Score** ($S_{rerank}$): Cross-encoder or lexical reranker output score.
4. **Authority Score** ($S_{authority}$): Source reliability rating (1.0 for official standards).
5. **Information Density** ($S_{density}$): Ratio of content tokens to boilerplate.
6. **Section Relevance** ($S_{section}$): Structural match against query intent.

---

## 5. Answer Generation & Citations

- **Model**: `qwen3:4b` running via Ollama.
- **System Prompt**: Enforces strict grounding, citation tags `[DOCUMENT]` / `[WEB]`, conflict identification, and explicit refusal if context is insufficient:
  > *"If CONTEXT is insufficient, say: 'I could not find enough relevant information in the knowledge base to answer this question.'"*
- **Streaming Protocol**: NDJSON Server-Sent Events (SSE) over HTTP chunked transfer.
- **Thinking Tags**: Built-in regex extraction of `<think>...</think>` internal reasoning blocks.

---

## 6. Test Environment & Instrumentation

- **OS**: Windows 11 Home 64-bit
- **Hardware**: Multi-core CPU, Local GPU acceleration
- **UI Automation**: Playwright CLI (`@playwright/cli` v0.262.0) with Chromium headless engine.
- **Database Backend**: SQLite 3 database at `server/data.db` tracking chat sessions, history, and evaluation records.
