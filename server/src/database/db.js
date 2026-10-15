const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = path.join(__dirname, "../../data.db");
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_filename TEXT NOT NULL,
    stored_filename TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    uploaded_at TEXT NOT NULL,
    extracted_text TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','processing','ready','failed')),
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS chat_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    sources TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New chat',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS research_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    title TEXT,
    topic TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
    added_at TEXT NOT NULL,
    chunk_count INTEGER DEFAULT 0,
    error TEXT
  );
  CREATE TABLE IF NOT EXISTS kb_build_status (
    id INTEGER PRIMARY KEY CHECK(id=1),
    status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle','processing','completed','failed')),
    current_step TEXT,
    total_sources INTEGER DEFAULT 0,
    processed_sources INTEGER DEFAULT 0,
    failed_sources INTEGER DEFAULT 0,
    chunks_created INTEGER DEFAULT 0,
    updated_at TEXT
  );
  INSERT OR IGNORE INTO kb_build_status (id,status,current_step,updated_at) VALUES (1,'idle','idle',datetime('now'));
`);

const documentColumns = db.prepare("PRAGMA table_info(documents)").all();
if (!documentColumns.some((column) => column.name === "error")) {
  db.exec("ALTER TABLE documents ADD COLUMN error TEXT");
}

// --- Chat sessions migration ---
const historyColumns = db.prepare("PRAGMA table_info(chat_history)").all();
if (!historyColumns.some((c) => c.name === "session_id")) {
  db.exec("ALTER TABLE chat_history ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE");
}
if (!db.prepare("PRAGMA table_info(chat_history)").all().some((c) => c.name === "thinking")) {
  db.exec("ALTER TABLE chat_history ADD COLUMN thinking TEXT");
}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id, id)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC)"); } catch {}

// Backfill: existing messages without a session go into per-day legacy sessions
// (or a single "Previous chats" session) so old history is not lost.
try {
  const orphanCount = db.prepare("SELECT COUNT(*) as c FROM chat_history WHERE session_id IS NULL").get().c;
  if (orphanCount > 0) {
    const now = new Date().toISOString();
    const insertSession = db.prepare("INSERT INTO chat_sessions (title, created_at, updated_at) VALUES (?,?,?)");
    const createdIds = [];
    // Group orphans by date so they stay browsable
    const days = db.prepare("SELECT substr(created_at,1,10) as day, MIN(created_at) as min_t, MAX(created_at) as max_t FROM chat_history WHERE session_id IS NULL GROUP BY day ORDER BY day ASC").all();
    if (days.length <= 1) {
      const info = insertSession.run("Previous chats", now, now);
      createdIds.push(info.lastInsertRowid);
      db.prepare("UPDATE chat_history SET session_id = ? WHERE session_id IS NULL").run(info.lastInsertRowid);
    } else {
      for (const d of days) {
        const info = insertSession.run(`Previous chats · ${d.day}`, d.min_t || now, d.max_t || now);
        createdIds.push(info.lastInsertRowid);
        db.prepare("UPDATE chat_history SET session_id = ? WHERE session_id IS NULL AND substr(created_at,1,10) = ?").run(info.lastInsertRowid, d.day);
      }
    }
    // Auto-title the newly created legacy sessions from their first question
    for (const sid of createdIds) {
      const first = db.prepare("SELECT question FROM chat_history WHERE session_id = ? ORDER BY id ASC LIMIT 1").get(sid);
      if (first && first.question) {
        const title = String(first.question).trim().slice(0, 60) || "Previous chats";
        db.prepare("UPDATE chat_sessions SET title = ? WHERE id = ?").run(title, sid);
      }
    }
  }
} catch (e) { console.error("chat sessions backfill failed:", e.message); }

// --- Change 2: structured evidence metadata tables (safe, non-destructive) ---
db.exec(`
  CREATE TABLE IF NOT EXISTS document_versions (
    version_id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version TEXT NOT NULL DEFAULT '1.0',
    effective_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','draft')),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chunk_metadata (
    chunk_id TEXT PRIMARY KEY,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version_id INTEGER REFERENCES document_versions(version_id) ON DELETE SET NULL,
    page INTEGER,
    section TEXT,
    source TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_document_versions_document ON document_versions(document_id);
  CREATE INDEX IF NOT EXISTS idx_chunk_metadata_document ON chunk_metadata(document_id);
  CREATE INDEX IF NOT EXISTS idx_chunk_metadata_version ON chunk_metadata(version_id);
`);

// --- Change 5: evaluation tables (safe, non-destructive; schema shared with tests) ---
db.exec(require("../evaluation/schema").EVAL_SCHEMA_SQL);
require("../evaluation/schema").ensureEvaluationTables(db);
function getDb() {
  return db;
}

module.exports = { getDb, db };
