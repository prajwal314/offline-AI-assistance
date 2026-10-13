const fs = require("fs");
const path = require("path");
const { getDb } = require("../database/db");
const { extractText } = require("../services/pdfService");
const { chunkDocument } = require("../services/chunkingService");
const { generateEmbeddings } = require("../services/embeddingService");
const { addChunks, deleteByDocumentId } = require("../services/chromaService");

async function processDocument(docId, filePath, originalFilename, sessionId) {
  const db = getDb();
  try {
    db.prepare("UPDATE documents SET status = 'processing' WHERE id = ?").run(docId);

    const { text } = await extractText(filePath);

    if (!text || text.trim().length === 0) {
      throw new Error("Empty PDF: no extractable text");
    }

    db.prepare("UPDATE documents SET extracted_text = ? WHERE id = ?").run(text, docId);

    const chunks = chunkDocument({ text, documentId: docId, filename: originalFilename, sessionId });

    if (chunks.length === 0) {
      throw new Error("Chunking produced no chunks");
    }

    const texts = chunks.map((c) => c.text);
    const embeddings = await generateEmbeddings(texts);

    const chromaChunks = chunks.map((c, i) => ({
      id: `${docId}_${c.metadata.chunkIndex}`,
      text: c.text,
      embedding: embeddings[i],
      metadata: c.metadata,
    }));

    await addChunks(chromaChunks);

    db.prepare("UPDATE documents SET status = 'ready' WHERE id = ?").run(docId);
    return { chunkCount: chunks.length, textLength: text.length };
  } catch (err) {
    try {
      const msg = String(err.message).slice(0, 500);
      const safe = msg.includes("Ollama") ? "Embedding generation failed because Ollama is unavailable." : msg.includes("Chroma") ? "Vector storage failed — ChromaDB unavailable." : msg;
      getDb().prepare("UPDATE documents SET status = 'failed', error=? WHERE id = ?").run(safe, docId);
    } catch (e) {}
    throw err;
  }
}

function resolveUploadSession(db, rawId, fallbackTitle) {
  if (rawId !== null && rawId !== undefined && rawId !== "") {
    const id = Number(rawId);
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
  // Auto-create: uploading from "New chat" provisions the session first so the
  // PDF is isolated to it from the start (per user's choice).
  const now = new Date().toISOString();
  const title = String(fallbackTitle || "New chat").trim().replace(/\s+/g, " ").slice(0, 60) || "New chat";
  const info = db.prepare("INSERT INTO chat_sessions (title, created_at, updated_at) VALUES (?,?,?)")
    .run(title, now, now);
  return db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(info.lastInsertRowid);
}

async function uploadDocument(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const db = getDb();
    const originalFilename = req.file.originalname;
    // Session isolation: every document belongs to exactly one session.
    let session;
    try {
      const rawSessionId = req.body?.sessionId ?? req.body?.session_id ?? req.query?.sessionId ?? null;
      session = resolveUploadSession(db, rawSessionId, originalFilename.replace(/\.pdf$/i, ""));
    } catch (e) {
      try { if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
      return res.status(e.status || 400).json({ success: false, message: e.message });
    }
    const storedFilename = req.file.filename;
    const filePath = req.file.path;
    const fileSize = req.file.size;
    const uploadedAt = new Date().toISOString();

    const info = db
      .prepare(
        "INSERT INTO documents (original_filename, stored_filename, file_path, file_size, uploaded_at, status, session_id) VALUES (?,?,?,?,?, 'uploaded', ?)"
      )
      .run(originalFilename, storedFilename, filePath, fileSize, uploadedAt, session.id);

    const docId = info.lastInsertRowid;

    try {
      const result = await processDocument(docId, filePath, originalFilename, session.id);
      const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(docId);
      db.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), session.id);
      const updatedSession = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(session.id);
      return res.json({
        success: true,
        document: {
          id: doc.id,
          filename: doc.original_filename,
          file_size: doc.file_size,
          status: doc.status,
          session_id: doc.session_id,
          extracted_text_length: result.textLength,
          chunkCount: result.chunkCount,
        },
        sessionId: session.id,
        session: updatedSession,
      });
    } catch (procErr) {
      const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(docId);
      return res.status(500).json({
        success: false,
        message: procErr.message,
        document: doc ? { id: doc.id, filename: doc.original_filename, status: doc.status } : null,
      });
    }
  } catch (err) {
    next(err);
  }
}

function listDocuments(req, res) {
  const rawSessionId = req.query?.sessionId ?? req.query?.session_id ?? null;
  if (rawSessionId !== null && rawSessionId !== undefined && rawSessionId !== "") {
    const id = Number(rawSessionId);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: "Invalid sessionId" });
    const docs = getDb().prepare("SELECT * FROM documents WHERE session_id = ? ORDER BY uploaded_at DESC").all(id);
    return res.json({ success: true, documents: docs, sessionId: id });
  }
  const docs = getDb().prepare("SELECT * FROM documents ORDER BY uploaded_at DESC").all();
  res.json({ success: true, documents: docs });
}

function getDocument(req, res) {
  const doc = getDb().prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
  if (!doc) return res.status(404).json({ success: false, message: "Document not found" });
  res.json({ success: true, document: doc });
}

async function deleteDocument(req, res, next) {
  try {
    const db = getDb();
    const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Document not found" });

    try {
      if (fs.existsSync(doc.file_path)) fs.unlinkSync(doc.file_path);
    } catch (e) {}

    try {
      await deleteByDocumentId(doc.id);
    } catch (e) {
      console.error("Chroma delete failed", e.message);
    }

    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);
    res.json({ success: true, message: "Document deleted" });
  } catch (err) {
    next(err);
  }
}

module.exports = { uploadDocument, listDocuments, getDocument, deleteDocument };
