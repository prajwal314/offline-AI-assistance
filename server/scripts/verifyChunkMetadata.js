const { getDb } = require("../src/database/db");
const { getAllChunks } = require("../src/services/chromaService");

(async function main() {
  const db = getDb();

  console.log("=== SQLite document_versions ===");
  console.table(db.prepare("SELECT * FROM document_versions ORDER BY version_id").all());

  console.log("=== SQLite chunk_metadata (first 20) ===");
  console.table(db.prepare("SELECT * FROM chunk_metadata ORDER BY chunk_id LIMIT 20").all());

  console.log("=== Chroma chunk sample ===");
  const chunks = await getAllChunks(null, 10);
  for (const c of chunks) {
    console.log(c.id, JSON.stringify(c.metadata));
  }
  console.log("Total Chroma chunks inspected:", chunks.length);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
