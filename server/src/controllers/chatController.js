const { getDb } = require("../database/db");
const { searchKnowledgeBase, normalizeTopK, normalizeThreshold } = require("../services/retrievalService");
const { streamAnswer, extractThinking } = require("../services/llmService");

const INSUFFICIENT_MSG = "I could not find enough relevant information in the knowledge base to answer this question.";
const HISTORY_CONTEXT_TURNS = 8;

function formatSourcesForApi(sources) {
  return sources.map((s) => {
    const m = s.metadata || {};
    const evidenceScore = s.evidenceScore ?? (s.denseScore ?? (s.distance != null ? Math.max(0, 1 - s.distance / 2) : null));
    const confidence = m.confidence || (evidenceScore != null ? (evidenceScore >= 0.65 ? "HIGH" : evidenceScore >= 0.4 ? "MEDIUM" : "LOW") : null);

    if (m.sourceType === "web") {
      return {
        type: "web",
        title: m.title || "Web",
        url: m.url || "",
        topic: m.topic || null,
        chunkIndex: m.chunkIndex ?? null,
        distance: s.distance ?? null,
        evidenceScore,
        confidence,
        sectionTitle: m.sectionTitle || null,
        dimensionBreakdown: s.dimensionBreakdown || null,
        id: s.id,
      };
    }
    return {
      type: "document",
      filename: m.filename || "document",
      page: m.pageNumber ?? m.page ?? null,
      chunkIndex: m.chunkIndex ?? null,
      documentId: m.documentId || null,
      distance: s.distance ?? null,
      evidenceScore,
      confidence,
      sectionTitle: m.sectionTitle || null,
      dimensionBreakdown: s.dimensionBreakdown || null,
      id: s.id,
    };
  });
}

function parseSourcesField(raw) {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// Split a stored row into clean answer + thinking.
// New rows have a dedicated `thinking` column; legacy rows may still
// carry <think>...</think> blocks inside `answer`, so extract on the fly.
function withThinking(row) {
  const storedThinking = (row.thinking || "").trim();
  const { thinking: tagThinking, answer: clean } = extractThinking(row.answer || "");
  const thinking = [storedThinking, tagThinking].filter(Boolean).join("\n\n").trim();
  return { ...row, answer: clean, thinking, sources: parseSourcesField(row.sources) };
}

function makeTitle(question) {
  const t = String(question || "").trim().replace(/\s+/g, " ");
  if (!t) return "New chat";
  return t.length > 60 ? t.slice(0, 60) + "…" : t;
}

function ensureSession(db, sessionId, firstQuestion) {
  if (sessionId !== null && sessionId !== undefined && sessionId !== "") {
    const id = Number(sessionId);
    if (!Number.isInteger(id)) {
      const err = new Error("Invalid sessionId");
      err.status = 400;
      throw err;
    }
    const existing = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
    if (!existing) {
      const err = new Error("Session not found");
      err.status = 404;
      throw err;
    }
    return existing;
  }
  const now = new Date().toISOString();
  const info = db.prepare("INSERT INTO chat_sessions (title, created_at, updated_at) VALUES (?,?,?)")
    .run(makeTitle(firstQuestion), now, now);
  return db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(info.lastInsertRowid);
}

function getSessionContext(db, sessionId, limit = HISTORY_CONTEXT_TURNS) {
  const rows = db.prepare(
    "SELECT question, answer FROM chat_history WHERE session_id = ? ORDER BY id DESC LIMIT ?"
  ).all(sessionId, limit);
  return rows.reverse().map((r) => ({ question: r.question, answer: r.answer }));
}

function touchSession(db, sessionId, firstQuestionIfUntitled) {
  const now = new Date().toISOString();
  if (firstQuestionIfUntitled) {
    const s = db.prepare("SELECT title FROM chat_sessions WHERE id = ?").get(sessionId);
    if (s && (!s.title || s.title === "New chat")) {
      db.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?")
        .run(makeTitle(firstQuestionIfUntitled), now, sessionId);
      return;
    }
  }
  db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
}

async function chat(req, res, next) {
  try {
    const { question, topK, threshold, filter } = req.body;
    const sessionIdRaw = req.body.sessionId ?? req.body.session_id ?? null;
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

    const db = getDb();
    let session;
    try {
      session = ensureSession(db, sessionIdRaw, question);
    } catch (e) {
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }
    const conversationHistory = getSessionContext(db, session.id);

    const { results: initialResults, filteredCount, where, topK: effectiveK } = await searchKnowledgeBase(question, k, { threshold: thr, filter: parsedFilter, mode: req.body.mode });

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = (event) => res.write(`${JSON.stringify(event)}\n`);
    const nowIso = new Date().toISOString();

    const saveMessage = (answerText, thinkingText, rawSources) => {
      db.prepare("INSERT INTO chat_history (question, answer, thinking, sources, created_at, session_id) VALUES (?,?,?,?,?,?)")
        .run(question, answerText, thinkingText || "", JSON.stringify(rawSources), nowIso, session.id);
      const count = db.prepare("SELECT COUNT(*) as c FROM chat_history WHERE session_id = ?").get(session.id).c;
      touchSession(db, session.id, count <= 1 ? question : null);
      return db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(session.id);
    };

    // Change 4: evidence assembly (decompose -> coverage -> select ->
    // conflicts -> sufficiency) runs ONLY in adaptive mode. All other modes
    // keep the exact behaviour below unchanged.
    const { getRetrievalMode } = require("../retrieval/index");
    let results = initialResults;
    let evidence = null;
    if (getRetrievalMode(req.body.mode) === "adaptive") {
      const { assembleEvidence } = require("../evidence/assembler");
      const retrieveFn = (q, tk) =>
        searchKnowledgeBase(q, tk, { threshold: thr, filter: parsedFilter, mode: "adaptive" }).then((r) => r.results || []);
      const assembled = await assembleEvidence(question, retrieveFn, {
        topK: k,
        coverageMethod: req.body.coverageMethod,
      });
      results = assembled.selected;
      evidence = {
        verdict: assembled.verdict,
        conflicts: assembled.conflicts,
        coverageRatio: assembled.coverage.coverageRatio,
        uncovered: assembled.coverage.uncovered,
        debug: assembled.debug,
      };
      if (assembled.verdict === "abstain") {
        const updatedSession = saveMessage(assembled.message, "", []);
        sendEvent({ type: "done", success: true, answer: assembled.message, thinking: "", sources: [], topK: effectiveK, threshold: thr, where, filteredCount, insufficient: true, sessionId: session.id, session: updatedSession, evidence });
        return res.end();
      }
    }

    if (results.length === 0) {
      const updatedSession = saveMessage(INSUFFICIENT_MSG, "", []);
      sendEvent({ type: "done", success: true, answer: INSUFFICIENT_MSG, thinking: "", sources: [], topK: effectiveK, threshold: thr, where, filteredCount, insufficient: true, sessionId: session.id, session: updatedSession });
      return res.end();
    }

    const sources = formatSourcesForApi(results);
    sendEvent({ type: "meta", sources, topK: effectiveK, threshold: thr, where, filteredCount, sessionId: session.id, ...(evidence ? { evidence } : {}) });

    let answer = "";
    let thinking = "";
    try {
      const streamed = await streamAnswer(
        question,
        results,
        (token) => sendEvent({ type: "token", token }),
        conversationHistory,
        (thinkingToken) => sendEvent({ type: "thinking", token: thinkingToken })
      );
      if (typeof streamed === "string") {
        const split = extractThinking(streamed);
        answer = split.answer;
        thinking = split.thinking;
      } else {
        answer = (streamed.answer || "").trim();
        thinking = (streamed.thinking || "").trim();
      }
    } catch (e) {
      if (String(e.message).includes("Ollama")) {
        sendEvent({ type: "error", success: false, message: "Ollama unavailable: " + e.message, sessionId: session.id });
        return res.end();
      }
      throw e;
    }
    if (!answer) answer = INSUFFICIENT_MSG;

    // Change 4: qualified verdicts surface conflicts next to the answer while
    // keeping the source citations above intact.
    if (evidence && evidence.verdict === "qualified" && evidence.conflicts.length > 0) {
      const notes = evidence.conflicts.map((c) => c.summary).join(" ");
      answer = `${answer}\n\nNote on sources: ${notes}`;
    }

    const updatedSession = saveMessage(answer, thinking, results);
    sendEvent({ type: "done", success: true, answer, thinking, sources, topK: effectiveK, threshold: thr, where, filteredCount, sessionId: session.id, session: updatedSession, ...(evidence ? { evidence } : {}) });
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(`${JSON.stringify({ type: "error", success: false, message: err.message })}\n`);
      res.end();
    } else next(err);
  }
}

function getHistory(req, res) {
  const db = getDb();
  const sessionId = req.query.sessionId ?? req.query.session_id ?? null;
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  if (sessionId !== null && sessionId !== undefined && sessionId !== "") {
    const id = Number(sessionId);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid sessionId" });
    const rows = db.prepare("SELECT * FROM chat_history WHERE session_id = ? ORDER BY id ASC LIMIT ?").all(id, limit);
    const history = rows.map(withThinking);
    return res.json({ success: true, history, sessionId: id });
  }
  const rows = getDb().prepare("SELECT * FROM chat_history ORDER BY created_at DESC LIMIT ?").all(limit);
  const history = rows.map(withThinking);
  res.json({ success: true, history });
}

function listSessions(req, res, next) {
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM chat_history h WHERE h.session_id = s.id) as message_count,
        (SELECT h.question FROM chat_history h WHERE h.session_id = s.id ORDER BY h.id DESC LIMIT 1) as last_question,
        (SELECT h.created_at FROM chat_history h WHERE h.session_id = s.id ORDER BY h.id DESC LIMIT 1) as last_message_at
      FROM chat_sessions s ORDER BY s.updated_at DESC
    `).all();
    res.json({ success: true, sessions: rows });
  } catch (err) { next(err); }
}

function createSession(req, res, next) {
  try {
    const db = getDb();
    const now = new Date().toISOString();
    const title = req.body && req.body.title ? String(req.body.title).slice(0, 120) : "New chat";
    const info = db.prepare("INSERT INTO chat_sessions (title, created_at, updated_at) VALUES (?,?,?)").run(title, now, now);
    const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(info.lastInsertRowid);
    res.json({ success: true, session });
  } catch (err) { next(err); }
}

function getSessionMessages(req, res) {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid session id" });
  const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
  if (!session) return res.status(404).json({ success: false, message: "Session not found" });
  const rows = db.prepare("SELECT * FROM chat_history WHERE session_id = ? ORDER BY id ASC LIMIT 500").all(id);
  const messages = rows.map(withThinking);
  res.json({ success: true, session, messages });
}

function renameSession(req, res) {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid session id" });
  const title = req.body && req.body.title ? String(req.body.title).trim().slice(0, 120) : "";
  if (!title) return res.status(400).json({ success: false, message: "Title is required" });
  const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
  if (!session) return res.status(404).json({ success: false, message: "Session not found" });
  db.prepare("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, new Date().toISOString(), id);
  res.json({ success: true, session: db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id) });
}

function deleteSession(req, res) {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid session id" });
  const session = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(id);
  if (!session) return res.status(404).json({ success: false, message: "Session not found" });
  db.prepare("DELETE FROM chat_history WHERE session_id = ?").run(id);
  db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(id);
  res.json({ success: true, deletedId: id });
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
    let sessionCount = 0;
    let messageCount = 0;
    try {
      sessionCount = db.prepare("SELECT COUNT(*) as c FROM chat_sessions").get().c;
      messageCount = db.prepare("SELECT COUNT(*) as c FROM chat_history").get().c;
    } catch {}
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
    res.json({ success: true, stats: { total, ready, failed, processing, chunkCount, docChunks, webChunks, webSources: webCompleted, webTotal, sessionCount, messageCount } });
  } catch (err) { next(err); }
}

module.exports = { chat, getHistory, getStats, listSessions, createSession, getSessionMessages, renameSession, deleteSession, formatSourcesForApi, INSUFFICIENT_MSG };
