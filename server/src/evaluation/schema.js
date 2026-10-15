/**
 * Evaluation SQLite schema (Change 5, step 1). Safe: CREATE TABLE IF NOT
 * EXISTS only — never deletes or alters existing data. Shared by db.js
 * (real database) and tests (in-memory database).
 */

const EVAL_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS evaluation_questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    expected_answer TEXT NOT NULL DEFAULT '',
    required_evidence_ids TEXT NOT NULL DEFAULT '[]',
    question_type TEXT NOT NULL DEFAULT 'simple_factual'
      CHECK(question_type IN ('simple_factual','exact_id_lookup','multi_chunk','date_sensitive','conflicting_evidence')),
    split TEXT NOT NULL DEFAULT 'test'
      CHECK(split IN ('train','validation','test')),
    expected_conflict TEXT,
    expected_preferred_chunk TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evaluation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    method TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    dataset_version TEXT NOT NULL DEFAULT 'v1',
    timestamp TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS evaluation_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL REFERENCES evaluation_runs(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES evaluation_questions(id) ON DELETE CASCADE,
    precision_at_k REAL,
    recall_at_k REAL,
    mrr REAL,
    ndcg REAL,
    evidence_coverage REAL,
    redundancy_rate REAL,
    conflict_correct REAL,
    latency_ms INTEGER,
    context_tokens INTEGER,
    selected_chunk_ids TEXT NOT NULL DEFAULT '[]',
    answer_faithfulness REAL,
    citation_accuracy REAL,
    answer TEXT,
    answer_correct_judge REAL,
    answer_correct_reason TEXT,
    answer_token_f1 REAL,
    grounded_supported_pct REAL,
    grounded_unsupported_pct REAL,
    citation_support_accuracy REAL,
    answer_agreement REAL,
    retrieval_stability REAL,
    conflict_detected INTEGER,
    conflict_handled REAL,
    retrieval_ms INTEGER,
    selection_ms INTEGER,
    generation_ms INTEGER,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_eval_results_run ON evaluation_results(run_id);
  CREATE INDEX IF NOT EXISTS idx_eval_questions_split ON evaluation_questions(split);
`;

// New results columns added after the initial Change-5 release. ensureEvaluationTables
// migrates pre-existing databases without touching stored rows.
const RESULTS_MIGRATION_COLUMNS = [
  ["answer", "TEXT"],
  ["answer_correct_judge", "REAL"],
  ["answer_correct_reason", "TEXT"],
  ["answer_token_f1", "REAL"],
  ["grounded_supported_pct", "REAL"],
  ["grounded_unsupported_pct", "REAL"],
  ["citation_support_accuracy", "REAL"],
  ["answer_agreement", "REAL"],
  ["retrieval_stability", "REAL"],
  ["conflict_detected", "INTEGER"],
  ["conflict_handled", "REAL"],
  ["retrieval_ms", "INTEGER"],
  ["selection_ms", "INTEGER"],
  ["generation_ms", "INTEGER"],
];

function ensureEvaluationTables(db) {
  db.exec(EVAL_SCHEMA_SQL);
  const existing = new Set(
    db.prepare("PRAGMA table_info(evaluation_results)").all().map((c) => c.name)
  );
  for (const [name, type] of RESULTS_MIGRATION_COLUMNS) {
    if (!existing.has(name)) db.exec(`ALTER TABLE evaluation_results ADD COLUMN ${name} ${type}`);
  }
}

module.exports = { EVAL_SCHEMA_SQL, ensureEvaluationTables };
