const path = require("path");
const { getDb } = require("../src/database/db");
const { deleteByDocumentId } = require("../src/services/chromaService");
const { processDocument } = require("../src/controllers/documentController");

async function main() {
  const db = getDb();
  const docs = db.prepare("SELECT * FROM documents ORDER BY id ASC").all();
  console.log(`Found ${docs.length} documents to re-ingest.`);

  for (const doc of docs) {
    try {
      // Ensure a version record exists (default metadata when absent)
      let versionRow = db.prepare("SELECT * FROM document_versions WHERE document_id = ? ORDER BY version_id ASC LIMIT 1").get(doc.id);
      if (!versionRow) {
        const uploadedAt = doc.uploaded_at || new Date().toISOString();
        const info = db.prepare(
          "INSERT INTO document_versions (document_id, version, effective_date, status, created_at) VALUES (?,?,?,?,?)"
        ).run(doc.id, "1.0", (uploadedAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10), "active", uploadedAt || new Date().toISOString());
        versionRow = { version_id: info.lastInsertRowid };
      }

      try { await deleteByDocumentId(doc.id); } catch (e) { console.warn("Chroma delete failed for doc", doc.id, e.message); }
      try { db.prepare("DELETE FROM chunk_metadata WHERE document_id = ?").run(doc.id); } catch (e) {}

      const result = await processDocument(doc.id, doc.file_path, doc.original_filename, { versionId: versionRow.version_id });
      console.log(`Re-ingested doc ${doc.id} (${doc.original_filename}): ${result.chunkCount} chunks`);
    } catch (err) {
      console.error(`Failed doc ${doc.id} (${doc.original_filename}): ${err.message}`);
    }
  }

  console.log("Re-ingestion complete.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
