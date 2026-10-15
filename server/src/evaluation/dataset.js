/**
 * Evaluation dataset import (Change 5, step 2).
 * JSON/CSV import with validation. Question types:
 *   simple_factual | exact_id_lookup | multi_chunk | date_sensitive | conflicting_evidence
 * Splits: train | validation | test.
 */

const { getDb } = require("../database/db");

const QUESTION_TYPES = [
  "simple_factual",
  "exact_id_lookup",
  "multi_chunk",
  "date_sensitive",
  "conflicting_evidence",
];
const SPLITS = ["train", "validation", "test"];

function normalizeIds(value) {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {}
    return t.split(/[;,|]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function validateQuestion(raw, index) {
  const errors = [];
  const query = typeof raw.query === "string" ? raw.query.trim() : "";
  if (!query) errors.push("query is required");
  const question_type = raw.question_type || raw.questionType || "simple_factual";
  if (!QUESTION_TYPES.includes(question_type)) errors.push(`invalid question_type: ${question_type}`);
  const split = raw.split || "test";
  if (!SPLITS.includes(split)) errors.push(`invalid split: ${split}`);
  const expected_answer = raw.expected_answer ?? raw.expectedAnswer ?? "";
  return {
    ok: errors.length === 0,
    errors: errors.map((e) => `row ${index}: ${e}`),
    question: errors.length === 0 ? {
      query,
      expected_answer: String(expected_answer),
      required_evidence_ids: normalizeIds(raw.required_evidence_ids ?? raw.requiredEvidenceIds ?? []),
      question_type,
      split,
      expectedConflict: raw.expectedConflict ?? raw.expected_conflict ?? null,
      expectedPreferredChunk: raw.expectedPreferredChunk ?? raw.expected_preferred_chunk ?? null,
    } : null,
  };
}

// Minimal CSV parser (handles quoted fields, commas, escaped quotes).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => String(h).trim());
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] ?? ""; });
    return obj;
  });
}

function parseDatasetInput(input, format) {
  const fmt = (format || (typeof input === "string" ? "csv" : "json")).toLowerCase();
  if (fmt === "csv") {
    if (typeof input !== "string") throw new Error("CSV input must be a string");
    return parseCsv(input);
  }
  if (typeof input === "string") return JSON.parse(input);
  if (Array.isArray(input)) return input;
  throw new Error("unsupported dataset input (expected array, JSON string, or CSV string)");
}

/**
 * importDataset(input, opts) -> { imported, skipped, errors, ids }
 * opts: { format: 'json'|'csv', split (default per-row or 'test'), replace, db }
 * replace=true deletes existing rows in the target split(s) first.
 */
function importDataset(input, opts = {}) {
  const db = opts.db || getDb();
  const rows = parseDatasetInput(input, opts.format);
  const now = new Date().toISOString();
  let imported = 0;
  let skipped = 0;
  const errors = [];
  const ids = [];

  const insert = db.prepare(
    "INSERT INTO evaluation_questions (query, expected_answer, required_evidence_ids, question_type, split, expected_conflict, expected_preferred_chunk, created_at) VALUES (?,?,?,?,?,?,?,?)"
  );
  const doImport = () => {
    rows.forEach((raw, i) => {
      const withSplit = { ...raw };
      if (opts.split && SPLITS.includes(opts.split)) withSplit.split = opts.split;
      const v = validateQuestion(withSplit, i + 1);
      if (!v.ok) { skipped++; errors.push(...v.errors); return; }
      const info = insert.run(
        v.question.query,
        v.question.expected_answer,
        JSON.stringify(v.question.required_evidence_ids),
        v.question.question_type,
        v.question.split,
        v.question.expectedConflict,
        v.question.expectedPreferredChunk
      , now);
      imported++;
      ids.push(Number(info.lastInsertRowid));
    });
  };

  if (opts.replace) {
    const splits = [...new Set(rows.map((r) => (opts.split && SPLITS.includes(opts.split)) ? opts.split : (SPLITS.includes(r.split) ? r.split : "test")))];
    const txn = db.transaction(() => {
      for (const s of splits) db.prepare("DELETE FROM evaluation_questions WHERE split = ?").run(s);
      doImport();
    });
    txn();
  } else {
    doImport();
  }
  return { imported, skipped, errors, ids };
}

function listQuestions(split, db) {
  const conn = db || getDb();
  const rows = split
    ? conn.prepare("SELECT * FROM evaluation_questions WHERE split = ? ORDER BY id").all(split)
    : conn.prepare("SELECT * FROM evaluation_questions ORDER BY id").all();
  return rows.map((r) => ({ ...r, required_evidence_ids: JSON.parse(r.required_evidence_ids || "[]") }));
}

function clearQuestions(split, db) {
  const conn = db || getDb();
  if (split) return conn.prepare("DELETE FROM evaluation_questions WHERE split = ?").run(split).changes;
  return conn.prepare("DELETE FROM evaluation_questions").run().changes;
}

module.exports = {
  QUESTION_TYPES,
  SPLITS,
  validateQuestion,
  parseCsv,
  parseDatasetInput,
  importDataset,
  listQuestions,
  clearQuestions,
};
