const { buildKnowledgeBase, getStatus } = require("../services/knowledgeBaseService");
const { getCount } = require("../services/chromaService");
const { getDb } = require("../database/db");

async function build(req, res, next) {
  try {
    const sessionId = req.body?.sessionId ?? req.body?.session_id ?? req.query?.sessionId ?? null;
    if (sessionId === null || sessionId === undefined || sessionId === "") {
      return res.status(400).json({ success: false, message: "sessionId is required — web research builds into one chat session" });
    }
    await buildKnowledgeBase(sessionId);
    res.json({ success: true, message: "Knowledge base build started", sessionId: Number(sessionId) });
  } catch (e) { next(e); }
}

async function status(req, res, next) {
  try {
    const sessionId = req.query?.sessionId ?? req.query?.session_id ?? null;
    const s = getStatus(sessionId);
    let totalChunks = 0;
    try { totalChunks = await getCount(); } catch {}
    const db = getDb();
    const sid = Number(sessionId);
    const scoped = Number.isInteger(sid) && req.query?.sessionId !== undefined;
    const docs = scoped
      ? db.prepare("SELECT COUNT(*) as c FROM documents WHERE session_id = ?").get(sid).c
      : db.prepare("SELECT COUNT(*) as c FROM documents").get().c;
    const webTotal = scoped
      ? db.prepare("SELECT COUNT(*) as c FROM research_sources WHERE session_id = ?").get(sid).c
      : db.prepare("SELECT COUNT(*) as c FROM research_sources").get().c;
    const webCompleted = scoped
      ? db.prepare("SELECT COUNT(*) as c FROM research_sources WHERE status='completed' AND session_id = ?").get(sid).c
      : db.prepare("SELECT COUNT(*) as c FROM research_sources WHERE status='completed'").get().c;
    const sources = scoped
      ? db.prepare("SELECT id,title,topic,url,status,chunk_count,error FROM research_sources WHERE session_id = ? ORDER BY added_at DESC LIMIT 50").all(sid)
      : db.prepare("SELECT id,title,topic,url,status,chunk_count,error FROM research_sources ORDER BY added_at DESC LIMIT 50").all();
    res.json({ success: true, status: s.status, currentStep: s.current_step, totalSources: s.total_sources, processedSources: s.processed_sources, failedSources: s.failed_sources, chunksCreated: s.chunks_created, documents: docs, webSources: webCompleted, webTotal, totalChunks, updatedAt: s.updated_at, sources, sessionId: scoped ? sid : null });
  } catch (e) { next(e); }
}

module.exports = { build, status };
