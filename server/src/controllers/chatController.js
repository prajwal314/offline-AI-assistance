const { getDb } = require("../database/db");
const { searchKnowledgeBase } = require("../services/retrievalService");
const { generateAnswer } = require("../services/llmService");

async function chat(req, res, next) {
  try {
    const { question, topK } = req.body;
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return res.status(400).json({ success: false, message: "Question is required" });
    }
    const k = topK ? parseInt(topK, 10) : 5;
    const sources = await searchKnowledgeBase(question, k);
    const answer = await generateAnswer(question, sources);

    const db = getDb();
    const createdAt = new Date().toISOString();
    db.prepare("INSERT INTO chat_history (question, answer, sources, created_at) VALUES (?,?,?,?)").run(
      question,
      answer,
      JSON.stringify(sources),
      createdAt
    );

    const formattedSources = sources.map((s) => {
      const m = s.metadata || {};
      if (m.sourceType === "web") return { ...s, display: `🌐 ${m.title || "Web"} — ${m.url}`, kind: "web" };
      return { ...s, display: `📄 ${m.filename || "document"} — chunk ${m.chunkIndex ?? ""}`, kind: "document" };
    });
    res.json({ success: true, answer, sources: formattedSources });
  } catch (err) {
    next(err);
  }
}

function getHistory(req, res) {
  const rows = getDb().prepare("SELECT * FROM chat_history ORDER BY created_at DESC LIMIT 50").all();
  const history = rows.map((r) => ({
    ...r,
    sources: r.sources ? JSON.parse(r.sources) : [],
  }));
  res.json({ success: true, history });
}

async function getStats(req, res, next) {
  try {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) as c FROM documents").get().c;
    const ready = db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='ready'").get().c;
    const failed = db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='failed'").get().c;
    const processing = db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='processing'").get().c;
    let chunkCount = 0;
    try {
      const { getCount } = require("../services/chromaService");
      chunkCount = await getCount();
    } catch (e) {
      chunkCount = 0;
    }
    res.json({ success: true, stats: { total, ready, failed, processing, chunkCount } });
  } catch (err) {
    next(err);
  }
}

module.exports = { chat, getHistory, getStats };
