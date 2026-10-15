/**
 * Evaluation API (Change 5, step 5).
 * POST /api/evaluation/run | GET /api/evaluation/results
 * POST /api/evaluation/dataset | GET /api/evaluation/runs
 * Retrieval debug lives in retrievalDebugController below
 * (GET /api/retrieval/debug/:queryId, dev-only).
 */

const { getDb } = require("../database/db");
const { importDataset } = require("../evaluation/dataset");
const { runEvaluation, parseMethods } = require("../evaluation/runner");
const { comparisonMarkdown, resultsToCsv } = require("../evaluation/export");
const { sampleReview, reviewMarkdown } = require("../evaluation/review");

async function run(req, res, next) {
  try {
    const methods = parseMethods(req.body?.methods);
    const out = await runEvaluation({
      methods,
      split: req.body?.split || "test",
      topK: req.body?.topK ?? 5,
      datasetVersion: req.body?.datasetVersion || "v1",
      generateAnswers: req.body?.generateAnswers === true,
      consistencyN: req.body?.consistencyN ?? 0,
      config: req.body?.config || {},
    });
    const format = String(req.body?.format || "json").toLowerCase();
    const markdown = comparisonMarkdown(out.comparison, {
      title: "Retrieval experiment comparison",
      datasetVersion: out.datasetVersion,
      split: out.split,
      topK: out.topK,
      questionCount: out.questionCount,
    });
    if (format === "markdown") return res.json({ success: true, ...out, results: undefined, markdown });
    res.json({ success: true, ...out, markdown });
  } catch (err) { next(err); }
}

function results(req, res, next) {
  try {
    const db = getDb();
    const clauses = [];
    const params = [];
    if (req.query.runId) { clauses.push("r.run_id = ?"); params.push(Number(req.query.runId)); }
    if (req.query.method) { clauses.push("run.method = ?"); params.push(String(req.query.method).toUpperCase()); }
    if (req.query.split) { clauses.push("q.split = ?"); params.push(String(req.query.split)); }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.prepare(
      `SELECT r.*, run.method, q.query, q.question_type, q.split, q.expected_answer
       FROM evaluation_results r
       JOIN evaluation_runs run ON run.id = r.run_id
       JOIN evaluation_questions q ON q.id = r.question_id
       ${where} ORDER BY r.run_id, r.question_id LIMIT 2000`
    ).all(...params);
    if (String(req.query.format || "").toLowerCase() === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      return res.send(resultsToCsv(rows));
    }
    res.json({ success: true, count: rows.length, results: rows });
  } catch (err) { next(err); }
}

function runs(req, res, next) {
  try {
    const rows = getDb().prepare("SELECT * FROM evaluation_runs ORDER BY id DESC LIMIT 100").all();
    res.json({ success: true, runs: rows });
  } catch (err) { next(err); }
}

function importData(req, res, next) {
  try {
    const { format, data, split, replace } = req.body || {};
    if (data === undefined) return res.status(400).json({ success: false, message: "body.data is required (array, JSON string, or CSV string)" });
    const out = importDataset(data, { format, split, replace: replace === true });
    res.json({ success: true, ...out });
  } catch (err) { next(err); }
}

async function review(req, res, next) {
  try {
    const n = Math.max(1, Math.min(100, parseInt(req.query.n, 10) || 20));
    const sample = await sampleReview({
      runId: req.query.runId != null ? Number(req.query.runId) : undefined,
      n,
      seed: req.query.seed != null ? Number(req.query.seed) : 7,
    });
    if (String(req.query.format || "").toLowerCase() === "markdown") {
      res.setHeader("Content-Type", "text/markdown; charset=utf-8");
      return res.send(reviewMarkdown(sample));
    }
    res.json({ success: true, ...sample });
  } catch (err) { next(err); }
}

// Development-only retrieval debugger.
async function retrievalDebug(req, res, next) {
  try {
    if (process.env.EVAL_DEBUG_ENABLED !== "1") {
      return res.status(403).json({ success: false, message: "retrieval debug is disabled (set EVAL_DEBUG_ENABLED=1)" });
    }
    const db = getDb();
    const q = db.prepare("SELECT * FROM evaluation_questions WHERE id = ?").get(Number(req.params.queryId));
    if (!q) return res.status(404).json({ success: false, message: "evaluation question not found" });
    const method = String(req.query.method || "E").toUpperCase();
    if (!["A", "B", "C", "D", "E"].includes(method)) {
      return res.status(400).json({ success: false, message: "method must be one of A,B,C,D,E" });
    }
    const { METHOD_MODES } = require("../evaluation/runner");
    const { retrieve } = require("../retrieval/index");
    const topK = Math.max(1, parseInt(req.query.topK, 10) || 5);
    if (method === "E") {
      const { assembleEvidence } = require("../evidence/assembler");
      const assembled = await assembleEvidence(q.query, (qq, tk) => retrieve(qq, { mode: "adaptive", topK: tk }), { topK });
      return res.json({ success: true, questionId: q.id, query: q.query, method, mode: METHOD_MODES[method], debug: assembled.debug, verdict: assembled.verdict, message: assembled.message });
    }
    const t0 = Date.now();
    const selected = await retrieve(q.query, { mode: METHOD_MODES[method], topK });
    const { assessCoverage } = require("../evidence/coverage");
    const { detectConflicts } = require("../evidence/conflicts");
    const requirements = [{ id: "r1", text: q.query }];
    const coverage = await assessCoverage(requirements, selected, {});
    res.json({
      success: true, questionId: q.id, query: q.query, method, mode: METHOD_MODES[method],
      debug: { requirements, coverage, selected: selected.map((c) => ({ chunkId: String(c.chunkId ?? c.id), evidenceScore: c.evidenceScore ?? c.score ?? null })), conflicts: detectConflicts(selected), latencyMs: Date.now() - t0, meta: selected.meta || null },
    });
  } catch (err) { next(err); }
}

module.exports = { run, results, runs, importData, review, retrievalDebug };
