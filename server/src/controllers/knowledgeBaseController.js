const { buildKnowledgeBase, getStatus } = require("../services/knowledgeBaseService");
const { getCount } = require("../services/chromaService");
const { getDb } = require("../database/db");

async function build(req, res, next) {
  try {
    await buildKnowledgeBase();
    res.json({ success: true, message: "Knowledge base build started" });
  } catch (e) { next(e); }
}

async function status(req, res, next) {
  try {
    const s = getStatus();
    let totalChunks = 0;
    try { totalChunks = await getCount(); } catch {}
    const db = getDb();
    const docs = db.prepare("SELECT COUNT(*) as c FROM documents").get().c;
    const webTotal = db.prepare("SELECT COUNT(*) as c FROM research_sources").get().c;
    const webCompleted = db.prepare("SELECT COUNT(*) as c FROM research_sources WHERE status='completed'").get().c;
    res.json({ success: true, status: s.status, currentStep: s.current_step, totalSources: s.total_sources, processedSources: s.processed_sources, failedSources: s.failed_sources, chunksCreated: s.chunks_created, documents: docs, webSources: webCompleted, webTotal, totalChunks, updatedAt: s.updated_at });
  } catch (e) { next(e); }
}

module.exports = { build, status };
