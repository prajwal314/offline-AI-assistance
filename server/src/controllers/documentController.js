const fs = require("fs");
const path = require("path");
const { getDb } = require("../database/db");
const { extractText } = require("../services/pdfService");
const { chunkDocument } = require("../services/chunkingService");
const { generateEmbeddings } = require("../services/embeddingService");
const { addChunks, deleteByDocumentId } = require("../services/chromaService");

async function processDocument(docId, filePath, originalFilename) {
  const db = getDb();
  try {
    db.prepare("UPDATE documents SET status = 'processing' WHERE id = ?").run(docId);

    const { text } = await extractText(filePath);

    if (!text || text.trim().length === 0) {
      throw new Error("Empty PDF: no extractable text");
    }

    db.prepare("UPDATE documents SET extracted_text = ? WHERE id = ?").run(text, docId);

    const chunks = chunkDocument({ text, documentId: docId, filename: originalFilename });

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

async function uploadDocument(req, res, next) {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const db = getDb();
    const originalFilename = req.file.originalname;
    const storedFilename = req.file.filename;
    const filePath = req.file.path;
    const fileSize = req.file.size;
    const uploadedAt = new Date().toISOString();

    const info = db
      .prepare(
        "INSERT INTO documents (original_filename, stored_filename, file_path, file_size, uploaded_at, status) VALUES (?,?,?,?,?, 'uploaded')"
      )
      .run(originalFilename, storedFilename, filePath, fileSize, uploadedAt);

    const docId = info.lastInsertRowid;

    try {
      const result = await processDocument(docId, filePath, originalFilename);
      const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(docId);
      return res.json({
        success: true,
        document: {
          id: doc.id,
          filename: doc.original_filename,
          file_size: doc.file_size,
          status: doc.status,
          extracted_text_length: result.textLength,
          chunkCount: result.chunkCount,
        },
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
