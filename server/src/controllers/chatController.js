const { getDb } = require("../database/db");
const { searchKnowledgeBase, normalizeTopK, normalizeThreshold } = require("../services/retrievalService");
const { streamAnswer } = require("../services/llmService");

const INSUFFICIENT_MSG = "I could not find enough relevant information in the knowledge base to answer this question.";

function formatSourcesForApi(sources) {
  return sources.map((s) => {
    const m = s.metadata || {};
    if (m.sourceType === "web") {
      return { type: "web", title: m.title || "Web", url: m.url || "", topic: m.topic || null, chunkIndex: m.chunkIndex ?? null, distance: s.distance ?? null, id: s.id };
    }
    return { type: "document", filename: m.filename || "document", page: m.pageNumber ?? m.page ?? null, chunkIndex: m.chunkIndex ?? null, documentId: m.documentId || null, distance: s.distance ?? null, id: s.id };
  });
}

async function chat(req, res, next) {
  try {
    const { question, topK, threshold, filter } = req.body;
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Question is required" });
    }
    if (question.length > 5000) return res.status(400).json({ success: false, message: "Question too long (max 5000 chars)" });
    const k = normalizeTopK(topK);
    const thr = normalizeThreshold(threshold);
    const parsedFilter = filter && typeof filter === "object" ? filter : {};
    if (req.body.sourceType) parsedFilter.sourceType = req.body.sourceType;
    if (req.body.documentId) parsedFilter.documentId = req.body.documentId;
    if (req.body.topic) parsedFilter.topic = req.body.topic;

    const { results, filteredCount, where, topK: effectiveK } = await searchKnowledgeBase(question, k, { threshold: thr, filter: parsedFilter });

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (event) => res.write(`${JSON.stringify(event)}\n`);

    if (results.length === 0) {
      const db = getDb();
      db.prepare("INSERT INTO chat_history (question, answer, sources, created_at) VALUES (?,?,?,?)").run(question, INSUFFICIENT_MSG, JSON.stringify([]), new Date().toISOString());
      sendEvent({ type: "done", success: true, answer: INSUFFICIENT_MSG, sources: [], topK: effectiveK, threshold: thr, where, filteredCount, insufficient: true });
      return res.end();
    }

    const sources = formatSourcesForApi(results);
    sendEvent({ type: "meta", sources, topK: effectiveK, threshold: thr, where, filteredCount });

    let answer = "";
    try {
      answer = await streamAnswer(question, results, (token) => sendEvent({ type: "token", token }));
    } catch (e) {
      if (String(e.message).includes("Ollama")) {
        sendEvent({ type: "error", success: false, message: "Ollama unavailable: " + e.message });
        return res.end();
      }
      throw e;
    }
    if (!answer) answer = INSUFFICIENT_MSG;

    const db = getDb();
    db.prepare("INSERT INTO chat_history (question, answer, sources, created_at) VALUES (?,?,?,?)").run(question, answer, JSON.stringify(results), new Date().toISOString());
    sendEvent({ type: "done", success: true, answer, sources, topK: effectiveK, threshold: thr, where, filteredCount });
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(`${JSON.stringify({ type: "error", success: false, message: err.message })}\n`);
      res.end();
    } else next(err);
  }
}

function getHistory(req, res) {
  const rows = getDb().prepare("SELECT * FROM chat_history ORDER BY created_at DESC LIMIT 50").all();
  const history = rows.map((r) => ({ ...r, sources: r.sources ? JSON.parse(r.sources) : [] }));
  res.json({ success: true, history });
}

async function getStats(req, res, next) {
  try {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) as c FROM documents").get().c;
    const ready = db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='ready'").get().c;
    const failed = db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='failed'").get().c;
    const processing = db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='processing'").get().c;
    const webTotal = db.prepare("SELECT COUNT(*) as c FROM research_sources").get().c;
    const webCompleted = db.prepare("SELECT COUNT(*) as c FROM research_sources WHERE status='completed'").get().c;
    let chunkCount = 0;
    let webChunks = 0;
    let docChunks = 0;
    try {
      const { getCollection } = require("../services/chromaService");
      const col = await getCollection();
      chunkCount = await col.count();
      try {
        const docRes = await col.get({ where: { sourceType: "document" }, limit: 10000 });
        docChunks = docRes.ids ? docRes.ids.length : 0;
        const webRes = await col.get({ where: { sourceType: "web" }, limit: 10000 });
        webChunks = webRes.ids ? webRes.ids.length : 0;
        if (chunkCount === 0) chunkCount = docChunks + webChunks;
      } catch {}
    } catch { chunkCount = 0; }
    res.json({ success: true, stats: { total, ready, failed, processing, chunkCount, docChunks, webChunks, webSources: webCompleted, webTotal } });
  } catch (err) { next(err); }
}

module.exports = { chat, getHistory, getStats, formatSourcesForApi, INSUFFICIENT_MSG };
