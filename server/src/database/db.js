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

function getDb() {
  return db;
}

module.exports = { getDb, db };
