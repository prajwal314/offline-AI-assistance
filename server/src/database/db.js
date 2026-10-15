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
if (!db.prepare("PRAGMA table_info(documents)").all().some((c) => c.name === "session_id")) {
  db.exec("ALTER TABLE documents ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE");
}
if (!db.prepare("PRAGMA table_info(research_sources)").all().some((c) => c.name === "session_id")) {
  db.exec("ALTER TABLE research_sources ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE");
}
// Per-session web research needs the same URL in different sessions, so the
// legacy global UNIQUE(url) must become UNIQUE(url, session_id).
try {
  const rsSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='research_sources'").get() || {}).sql || "";
  const hasGlobalUnique = /research_sources[\s\S]*url[^,)]*unique/i.test(rsSql) || /unique[\s\S]*\(\s*url\s*\)/i.test(rsSql);
  if (hasGlobalUnique) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS research_sources_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        title TEXT,
        topic TEXT,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
        added_at TEXT NOT NULL,
        chunk_count INTEGER DEFAULT 0,
        error TEXT,
        session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE
      );
      INSERT OR IGNORE INTO research_sources_new (id,url,title,topic,status,added_at,chunk_count,error,session_id)
        SELECT id,url,title,topic,status,added_at,chunk_count,error,session_id FROM research_sources;
      DROP TABLE research_sources;
      ALTER TABLE research_sources_new RENAME TO research_sources;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_research_url_session ON research_sources(url, session_id);
    `);
    console.log("research_sources migrated to UNIQUE(url, session_id)");
  } else {
    try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_research_url_session ON research_sources(url, session_id)"); } catch {}
  }
} catch (e) { console.error("research_sources unique migration failed:", e.message); }

// --- Chat sessions migration ---
const historyColumns = db.prepare("PRAGMA table_info(chat_history)").all();
if (!historyColumns.some((c) => c.name === "session_id")) {
  db.exec("ALTER TABLE chat_history ADD COLUMN session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE");
}
if (!db.prepare("PRAGMA table_info(chat_history)").all().some((c) => c.name === "thinking")) {
  db.exec("ALTER TABLE chat_history ADD COLUMN thinking TEXT");
}
if (!db.prepare("PRAGMA table_info(chat_history)").all().some((c) => c.name === "duration_ms")) {
  db.exec("ALTER TABLE chat_history ADD COLUMN duration_ms INTEGER");
}
// V2 Confidence-Aware RAG: per-answer evidence trace (decision, retry, signals).
if (!db.prepare("PRAGMA table_info(chat_history)").all().some((c) => c.name === "evidence")) {
  db.exec("ALTER TABLE chat_history ADD COLUMN evidence TEXT");
}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_chat_history_session ON chat_history(session_id, id)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id)"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_research_session ON research_sources(session_id)"); } catch {}

// Backfill: legacy global documents / web sources (session_id IS NULL) are
// assigned to a single session so they stay visible somewhere, while all
// future uploads/builds are strictly per-session.
try {
  const legacyDocs = db.prepare("SELECT COUNT(*) as c FROM documents WHERE session_id IS NULL").get().c;
  const legacyWeb = db.prepare("SELECT COUNT(*) as c FROM research_sources WHERE session_id IS NULL").get().c;
  if (legacyDocs > 0 || legacyWeb > 0) {
    let target = db.prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 1").get();
    if (!target) {
      const now = new Date().toISOString();
      const info = db.prepare("INSERT INTO chat_sessions (title, created_at, updated_at) VALUES (?,?,?)")
        .run("Migrated library", now, now);
      target = db.prepare("SELECT * FROM chat_sessions WHERE id = ?").get(info.lastInsertRowid);
    }
    if (legacyDocs > 0) db.prepare("UPDATE documents SET session_id = ? WHERE session_id IS NULL").run(target.id);
    if (legacyWeb > 0) db.prepare("UPDATE research_sources SET session_id = ? WHERE session_id IS NULL").run(target.id);
    console.log(`session isolation backfill: assigned ${legacyDocs} document(s) + ${legacyWeb} web source(s) to session ${target.id}`);
  }
} catch (e) { console.error("session isolation backfill failed:", e.message); }

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

function getDb() {
  return db;
}

module.exports = { getDb, db };
