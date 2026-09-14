const express = require("express");
const { LLM_MODEL, OLLAMA_URL } = require("../services/llmService");
const { EMBEDDING_MODEL } = require("../services/embeddingService");
const { CHROMA_URL, COLLECTION_NAME } = require("../services/chromaService");
const router = express.Router();

router.get("/ollama", async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error(`${r.status}`);
    const data = await r.json();
    const models = (data.models || []).map((m) => m.name);
    res.json({ available: true, llm: LLM_MODEL, embeddingModel: EMBEDDING_MODEL, models, url: OLLAMA_URL });
  } catch (e) {
    res.status(503).json({ available: false, llm: LLM_MODEL, embeddingModel: EMBEDDING_MODEL, error: e.message, url: OLLAMA_URL });
  }
});

router.get("/chromadb", async (req, res) => {
  try {
    const { getCollection, getCount } = require("../services/chromaService");
    await getCollection();
    const count = await getCount();
    res.json({ available: true, url: CHROMA_URL, collection: COLLECTION_NAME, count });
  } catch (e) {
    res.status(503).json({ available: false, url: CHROMA_URL, collection: COLLECTION_NAME, error: e.message });
  }
});

router.get("/all", async (req, res) => {
  const out = { backend: true, sqlite: true, chromadb: null, ollama: null };
  try {
    const { getDb } = require("../database/db");
    getDb().prepare("SELECT 1").get();
    out.sqlite = true;
  } catch { out.sqlite = false; }
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    out.ollama = r.ok;
  } catch { out.ollama = false; }
  try {
    const { getCollection } = require("../services/chromaService");
    await getCollection();
    out.chromadb = true;
  } catch { out.chromadb = false; }
  res.json(out);
});

module.exports = router;
