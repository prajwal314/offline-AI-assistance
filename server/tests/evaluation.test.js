/**
 * Unit tests for Change 5 (evaluation harness). Uses an in-memory SQLite
 * database — never touches the real data.db. Run with: npm test
 */

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { ensureEvaluationTables } = require("../src/evaluation/schema");
const { importDataset, validateQuestion, parseCsv, listQuestions, QUESTION_TYPES } = require("../src/evaluation/dataset");
const {
  precisionAtK, recallAtK, reciprocalRank, ndcgAtK, evidenceCoverage,
  redundancyRate, conflictCorrectness, contextTokens,
  judgeFaithfulness, judgeCitations, parseJudgeScore,
  tokens, tokenF1, parseCorrectnessJson, judgeCorrectness,
  splitClaims, extractCitations, judgeGroundedness,
  answerAgreement, measureConsistency, conflictHandled,
  percentile, summarizeLatencies,
} = require("../src/evaluation/evalMetrics");
const { parseMethods, evaluateQuestion, runEvaluation, METHOD_MODES } = require("../src/evaluation/runner");
const { comparisonMarkdown, resultsToCsv, RESULT_COLUMNS } = require("../src/evaluation/export");
const { sampleReview, reviewMarkdown } = require("../src/evaluation/review");
const { summarizeDetailed } = require("../src/evaluation/stats");

function memDb() {
  const db = new Database(":memory:");
  ensureEvaluationTables(db);
  return db;
}

function chunk(id, text, extra = {}) {
  return { chunkId: id, id, text, metadata: {}, evidenceScore: 0.8, ...extra };
}

// Stub retrieve: method-aware deterministic results over a fixed corpus.
function stubRetrieveFactory(corpus) {
  return async (query, opts = {}) => {
    const mode = opts.mode || "dense";
    if (mode === "dense") return [corpus[0]];
    if (mode === "hybrid") return [corpus[0], corpus[1]];
    return corpus; // rerank/meta/adaptive return the full pool
  };
}

const CORPUS = [
  chunk("1_0", "The application fee is 500 rupees"),
  chunk("1_1", "The deadline is 30 September"),
  chunk("9_9", "Weather forecast for the weekend"),
];

// ------------------------------------------------------------- dataset ---

describe("dataset import and validation", () => {
  it("accepts all five question types and three splits", () => {
    assert.deepEqual(QUESTION_TYPES, ["simple_factual", "exact_id_lookup", "multi_chunk", "date_sensitive", "conflicting_evidence"]);
    for (const t of QUESTION_TYPES) {
      assert.ok(validateQuestion({ query: "q?", question_type: t }).ok, t);
    }
    assert.ok(!validateQuestion({ query: "q?", question_type: "nope" }).ok);
    assert.ok(!validateQuestion({ query: "" }).ok);
    assert.ok(!validateQuestion({ query: "q?", split: "nope" }).ok);
  });

  it("imports JSON rows, skipping invalid ones with errors", () => {
    const db = memDb();
    const out = importDataset([
      { query: "What is the fee?", required_evidence_ids: ["1_0"], question_type: "simple_factual", split: "test" },
      { query: "", question_type: "simple_factual" },
      { query: "Bad type", question_type: "nope" },
    ], { db });
    assert.equal(out.imported, 1);
    assert.equal(out.skipped, 2);
    assert.equal(out.errors.length, 2);
    assert.equal(listQuestions("test", db).length, 1);
  });

  it("imports CSV with comma-separated evidence ids", () => {
    const db = memDb();
    const csv = 'query,expected_answer,required_evidence_ids,question_type,split\n"What is the fee, really?","500","1_0;1_1",simple_factual,test\n';
    const out = importDataset(csv, { format: "csv", db });
    assert.equal(out.imported, 1);
    assert.deepEqual(listQuestions("test", db)[0].required_evidence_ids, ["1_0", "1_1"]);
    assert.ok(parseCsv("").length === 0);
  });

  it("replace=true clears the target split first", () => {
    const db = memDb();
    importDataset([{ query: "old?", question_type: "simple_factual", split: "test" }], { db });
    importDataset([{ query: "new?", question_type: "simple_factual", split: "test" }], { db, replace: true });
    assert.deepEqual(listQuestions("test", db).map((q) => q.query), ["new?"]);
  });
});

// ------------------------------------------------------------- metrics ---

describe("evaluation metrics", () => {
  const sel = [chunk("1_0", "a"), chunk("9_9", "b")];

  it("precision/recall/MRR/NDCG over required ids", () => {
    assert.equal(precisionAtK(sel, ["1_0"], 2), 0.5);
    assert.equal(recallAtK(sel, ["1_0", "1_1"], 2), 0.5);
    assert.equal(reciprocalRank(sel, ["9_9"]), 0.5);
    assert.equal(ndcgAtK(sel, ["1_0"], 2), 1);
    assert.equal(ndcgAtK([], ["1_0"], 2), 0);
    assert.equal(recallAtK(sel, [], 2), 1);
  });

  it("evidence coverage gives full credit only when ALL required retrieved", () => {
    assert.equal(evidenceCoverage(sel, ["1_0", "9_9"]), 1);
    assert.equal(evidenceCoverage(sel, ["1_0", "1_1"]), 0);
    assert.equal(evidenceCoverage(sel, []), 1);
  });

  it("redundancy rate counts near-duplicate pairs", () => {
    assert.equal(redundancyRate([chunk("a", "same text here")], {}), 0);
    const dup = [chunk("a", "identical words here now"), chunk("b", "identical words here now")];
    assert.equal(redundancyRate(dup, {}), 1);
    assert.equal(redundancyRate(sel, {}), 0);
  });

  it("conflict correctness is null unless conflicting_evidence type", () => {
    assert.equal(conflictCorrectness({ question_type: "simple_factual" }, { conflictsDetected: [] }), null);
    assert.equal(conflictCorrectness({ question_type: "conflicting_evidence" }, { conflictsDetected: [{ summary: "x" }], preferredChunkId: "1_0" }), 1);
    assert.equal(conflictCorrectness({ question_type: "conflicting_evidence" }, { conflictsDetected: [] }), 0);
    assert.equal(conflictCorrectness({ question_type: "conflicting_evidence", expectedPreferredChunk: "2_0" }, { conflictsDetected: [{}], preferredChunkId: "1_0" }), 0);
    assert.equal(conflictCorrectness({ question_type: "conflicting_evidence", expectedConflict: "none" }, { conflictsDetected: [] }), 1);
  });

  it("context tokens approximate 4 chars per token", () => {
    assert.equal(contextTokens([{ text: "abcd" }]), 1);
    assert.equal(contextTokens([]), 0);
  });

  it("judges are labelled approximations and null-safe", async () => {
    const f = await judgeFaithfulness("q", "", ["e"]);
    assert.equal(f.score, null);
    assert.equal(f.approximation, true);
    const down = await judgeFaithfulness("q", "a", ["e"], { fetchFn: async () => { throw new Error("down"); } });
    assert.equal(down.score, null);
    assert.ok(down.note.includes("unavailable"));
    const c = await judgeCitations("see report.pdf for details", [{ metadata: { filename: "report.pdf" } }]);
    assert.equal(c.score, 1);
    assert.equal(c.approximation, true);
    assert.equal(parseJudgeScore("score: 0.75 good"), 0.75);
    assert.equal(parseJudgeScore("no score here"), null);
  });
});

// -------------------------------------------------------------- runner ---

describe("experiment runner A-E", () => {
  let db;
  beforeEach(() => {
    db = memDb();
    importDataset([
      { query: "Fee?", required_evidence_ids: ["1_0"], question_type: "simple_factual", split: "test" },
      { query: "Fee now?", required_evidence_ids: ["1_0"], question_type: "conflicting_evidence", split: "test", expectedPreferredChunk: "1_0" },
    ], { db });
  });

  it("maps letters to modes and rejects garbage", () => {
    assert.deepEqual(METHOD_MODES, { A: "dense", B: "hybrid", C: "hybrid_rerank", D: "hybrid_rerank_meta", E: "adaptive" });
    assert.deepEqual(parseMethods("A,B,C,D,E"), ["A", "B", "C", "D", "E"]);
    assert.throws(() => parseMethods("Z"), /no valid methods/);
  });

  it("evaluates every method on the same questions and persists runs", async () => {
    const out = await runEvaluation({ methods: "A,B,C,D,E", split: "test", topK: 2, db, retrieve: stubRetrieveFactory(CORPUS), maxRetries: 0 });
    assert.deepEqual(Object.keys(out.comparison).sort(), ["A", "B", "C", "D", "E"]);
    assert.equal(out.questionCount, 2);
    const runCount = db.prepare("SELECT COUNT(*) AS c FROM evaluation_runs").get().c;
    const resCount = db.prepare("SELECT COUNT(*) AS c FROM evaluation_results").get().c;
    assert.equal(runCount, 5);
    assert.equal(resCount, 10);
    // A retrieves only 1_0 -> full coverage on Q1; E exercises the assembler.
    assert.equal(out.results.A[0].evidence_coverage, 1);
    assert.ok(out.results.E[0].debug && Array.isArray(out.results.E[0].debug.requirements));
    for (const m of ["A", "B", "C", "D", "E"]) {
      assert.ok(typeof out.comparison[m].avgLatencyMs === "number");
      assert.ok(out.comparison[m].avgEvidenceCoverage !== undefined);
    }
  });

  it("throws on an empty split", async () => {
    await assert.rejects(runEvaluation({ methods: "A", split: "validation", db }), /no evaluation questions/);
  });
});

// -------------------------------------------------------------- export ---

describe("export: CSV and markdown table", () => {
  it("markdown table lists every method with no winner language", () => {
    const md = comparisonMarkdown({
      B: { method: "B", mode: "hybrid", n: 2, avgPrecision: 0.5, avgConflictCorrect: null },
      A: { method: "A", mode: "dense", n: 2, avgPrecision: 1, avgConflictCorrect: 0 },
    }, { title: "T", split: "test", topK: 2, questionCount: 2, datasetVersion: "v1" });
    assert.ok(md.includes("| A |") && md.includes("| B |"));
    assert.ok(!/winner|best|recommended/i.test(md));
  });

  it("CSV escapes and round-trips array fields", () => {
    const csv = resultsToCsv([{ run_id: 1, method: "A", question_id: 2, query: 'say "hi", ok', selected_chunk_ids: ["1_0", "1_1"], error: null }]);
    const lines = csv.split("\n");
    assert.equal(lines.length, 2);
    assert.ok(lines[1].includes('"say ""hi"", ok"'));
    assert.ok(lines[1].includes("1_0;1_1"));
  });

  it("CSV header carries the new per-question columns", () => {
    for (const col of ["answer", "answer_correct_judge", "answer_token_f1", "grounded_supported_pct", "grounded_unsupported_pct", "citation_support_accuracy", "answer_agreement", "retrieval_stability", "conflict_detected", "conflict_handled", "retrieval_ms", "selection_ms", "generation_ms"]) {
      assert.ok(RESULT_COLUMNS.includes(col), `missing column ${col}`);
    }
  });
});

// ------------------------------------------------- answer correctness ---

describe("answer correctness (F1 + strict-JSON judge)", () => {
  it("tokenF1 scores identical, partial, and empty answers", () => {
    assert.deepEqual(tokenF1("The fee is 500 rupees", "The fee is 500 rupees"), { precision: 1, recall: 1, f1: 1 });
    const partial = tokenF1("The fee is 500", "The fee is 500 rupees total");
    assert.ok(partial.precision === 1 && partial.recall < 1 && partial.f1 > 0 && partial.f1 < 1);
    assert.deepEqual(tokenF1("", "something"), { precision: 0, recall: 0, f1: 0 });
    assert.deepEqual(tokenF1("zzz qqq", "aaa bbb"), { precision: 0, recall: 0, f1: 0 });
  });

  it("parses strict-JSON verdicts incl. partial, rejects garbage", () => {
    assert.deepEqual(parseCorrectnessJson('{"correct": true, "reason": "matches"}'), { correct: true, reason: "matches" });
    assert.deepEqual(parseCorrectnessJson('```json\n{"correct": "partial", "reason": "half"}\n```'), { correct: "partial", reason: "half" });
    assert.deepEqual(parseCorrectnessJson('verdict: {"correct": false, "reason": "wrong number"} ok'), { correct: false, reason: "wrong number" });
    assert.equal(parseCorrectnessJson("looks good to me"), null);
    assert.equal(parseCorrectnessJson('{"correct": "maybe"}'), null);
  });

  it("judge maps true/partial/false to 1/0.5/0 and labels approximation", async () => {
    const mkFetch = (body) => async () => ({ ok: true, json: async () => ({ response: body }) });
    const t = await judgeCorrectness("q", "a", "e", { fetchFn: mkFetch('{"correct": true, "reason": "exact"}') });
    assert.equal(t.score, 1);
    assert.equal(t.approximation, true);
    const p = await judgeCorrectness("q", "a", "e", { fetchFn: mkFetch('{"correct": "partial", "reason": "missing unit"}') });
    assert.equal(p.score, 0.5);
    const f = await judgeCorrectness("q", "a", "e", { fetchFn: mkFetch('{"correct": false, "reason": "wrong"}') });
    assert.equal(f.score, 0);
    const down = await judgeCorrectness("q", "a", "e", { fetchFn: async () => { throw new Error("down"); } });
    assert.equal(down.score, null);
    assert.ok(down.reason.includes("unavailable"));
    const noAns = await judgeCorrectness("q", "", "e", {});
    assert.equal(noAns.score, null);
  });
});

// ------------------------------------------------------ groundedness ---

describe("groundedness (default metric) and citation support", () => {
  const sel = [
    chunk("1_0", "The application fee is 500 rupees"),
    { chunkId: "2_0", id: "2_0", text: "Report MICRO-2024 findings", metadata: { filename: "micro.pdf" }, evidenceScore: 0.7 },
  ];

  it("splits answers into claims and finds [id]/filename citations", () => {
    const claims = splitClaims("The fee is 500 rupees. See [1_0] for details.\n- x");
    assert.deepEqual(claims, ["The fee is 500 rupees.", "See [1_0] for details."]);
    assert.deepEqual(extractCitations("See [1_0] for details.", sel), ["1_0"]);
    assert.deepEqual(extractCitations("Per micro.pdf the fee holds.", sel), ["2_0"]);
    assert.deepEqual(extractCitations("No citations here at all.", sel), []);
  });

  it("reports supported/unsupported fractions with a stub judge", async () => {
    const g = await judgeGroundedness("q", "The fee is 500 rupees. The sky is green.", sel, {
      judgeFn: async (claim) => ({ supported: claim.includes("500"), reason: "stub" }),
    });
    assert.equal(g.approximation, true);
    assert.equal(g.supported_pct, 0.5);
    assert.equal(g.unsupported_pct, 0.5);
    assert.equal(g.claims.length, 2);
  });

  it("citation accuracy judges cited attachments only", async () => {
    const g = await judgeGroundedness("q", "The fee is 500 rupees [1_0].", sel, {
      judgeFn: async (claim, texts) => ({ supported: texts.some((t) => t.includes("500")), reason: "stub" }),
    });
    assert.equal(g.citation_accuracy, 1);
    const bad = await judgeGroundedness("q", "The fee is 999 rupees [1_0].", sel, {
      judgeFn: async (claim, texts) => ({ supported: texts.some((t) => t.includes("999")), reason: "stub" }),
    });
    assert.equal(bad.citation_accuracy, 0);
    const uncited = await judgeGroundedness("q", "The fee is 500 rupees.", sel, {
      judgeFn: async () => ({ supported: true, reason: "stub" }),
    });
    assert.equal(uncited.citation_accuracy, null);
    assert.equal(uncited.supported_pct, 1);
  });

  it("is null-safe without answer or sources", async () => {
    const g = await judgeGroundedness("q", "", sel, {});
    assert.equal(g.supported_pct, null);
    const g2 = await judgeGroundedness("q", "Some claim here.", [], {});
    assert.ok(g2.note.includes("no sources"));
  });
});

// ------------------------------------------------------ consistency ---

describe("answer consistency and retrieval stability", () => {
  it("identical runs agree fully; varied runs score below 1", async () => {
    const same = await measureConsistency(async () => ({ answer: "The fee is 500 rupees", selected: [chunk("1_0", "a")] }), { n: 3 });
    assert.equal(same.agreement, 1);
    assert.equal(same.stability, 1);
    let i = 0;
    const varied = await measureConsistency(async () => {
      i++;
      return i % 2 === 0
        ? { answer: "The fee is 500 rupees", selected: [chunk("1_0", "a")] }
        : { answer: "Weather is sunny today", selected: [chunk("9_9", "b")] };
    }, { n: 3 });
    assert.ok(varied.agreement < 1 && varied.agreement >= 0);
    assert.ok(varied.stability < 1 && varied.stability >= 0);
  });

  it("embedding agreement path uses the injected embedder", async () => {
    const { answerAgreement } = require("../src/evaluation/evalMetrics");
    const f1 = await answerAgreement("hello world", "hello world", {});
    assert.equal(f1, 1);
    const cos = await answerAgreement("a", "b", { embedFn: async () => [[1, 0], [0, 1]] });
    assert.equal(cos, 0);
  });

  it("needs at least 2 successful runs", async () => {
    const { measureConsistency } = require("../src/evaluation/evalMetrics");
    const r = await measureConsistency(async () => ({ answer: "x", selected: [] }), { n: 1 });
    assert.equal(r.agreement, null);
    assert.equal(r.stability, null);
  });
});

// --------------------------------------- cross-document consistency ---

describe("conflict handling verdicts", () => {
  const { conflictHandled } = require("../src/evaluation/evalMetrics");
  const q = { question_type: "conflicting_evidence" };

  it("scores qualified/abstain with right chunk as handled", () => {
    assert.equal(conflictHandled(q, { conflictsDetected: [{}], preferredChunkId: "1_0", verdict: "qualified" }), 1);
    assert.equal(conflictHandled(q, { conflictsDetected: [{}], preferredChunkId: "1_0", verdict: "abstain" }), 1);
  });

  it("marks undetected conflicts 0 and right-chunk-unverdicted 0.5", () => {
    assert.equal(conflictHandled(q, { conflictsDetected: [], preferredChunkId: null, verdict: null }), 0);
    assert.equal(conflictHandled(q, { conflictsDetected: [{}], preferredChunkId: "1_0", verdict: "answer" }), 0.5);
    // No labelled expectation: qualification alone counts as handled.
    assert.equal(conflictHandled(q, { conflictsDetected: [{}], preferredChunkId: "9_9", verdict: "qualified" }), 1);
  });

  it("returns null when not applicable, honours expectedConflict none", () => {
    assert.equal(conflictHandled({ question_type: "simple_factual" }, { conflictsDetected: [{}] }), null);
    assert.equal(conflictHandled({ ...q, expectedConflict: "none" }, { conflictsDetected: [] }), 1);
    assert.equal(conflictHandled({ ...q, expectedPreferredChunk: "2_0" }, { conflictsDetected: [{}], preferredChunkId: "1_0", verdict: "qualified" }), 0);
  });
});

// ------------------------------------------------- latency breakdown ---

describe("latency breakdown (mean/p50/p95)", () => {
  const { percentile, summarizeLatencies } = require("../src/evaluation/evalMetrics");

  it("percentiles interpolate and handle edges", () => {
    assert.equal(percentile([], 50), null);
    assert.equal(percentile([7], 95), 7);
    assert.equal(percentile([10, 20, 30, 40], 50), 25);
    assert.equal(percentile([10, 20, 30, 40], 0), 10);
  });

  it("summarizes each stage", () => {
    const s = summarizeLatencies([
      { retrieval_ms: 10, selection_ms: 2, generation_ms: 100, latency_ms: 112 },
      { retrieval_ms: 30, selection_ms: 4, generation_ms: 300, latency_ms: 334 },
    ]);
    assert.equal(s.retrieval_ms.mean, 20);
    assert.equal(s.retrieval_ms.p50, 20);
    assert.equal(s.generation_ms.p95, 290);
    assert.equal(summarizeLatencies([]).retrieval_ms.n, 0);
  });
});

// ------------------------------------------- schema migration safety ---

describe("evaluation schema migration", () => {
  it("adds new columns to a pre-existing results table without data loss", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE evaluation_results (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, question_id INTEGER, precision_at_k REAL, error TEXT)`);
    db.prepare("INSERT INTO evaluation_results (run_id, question_id, precision_at_k) VALUES (?,?,?)").run(1, 2, 0.5);
    ensureEvaluationTables(db);
    const cols = db.prepare("PRAGMA table_info(evaluation_results)").all().map((c) => c.name);
    for (const col of ["answer", "answer_correct_judge", "answer_token_f1", "grounded_supported_pct", "citation_support_accuracy", "answer_agreement", "retrieval_stability", "conflict_detected", "conflict_handled", "retrieval_ms", "selection_ms", "generation_ms"]) {
      assert.ok(cols.includes(col), `missing ${col}`);
    }
    const row = db.prepare("SELECT * FROM evaluation_results").get();
    assert.equal(row.precision_at_k, 0.5);
    assert.equal(row.question_id, 2);
    ensureEvaluationTables(db); // idempotent
  });
});

// ---------------------------------------- runner integration (new) ---

describe("runner records stages, answer metrics, and consistency", () => {
  let db;
  beforeEach(() => {
    db = memDb();
    importDataset([
      { query: "Fee?", expected_answer: "500 rupees", required_evidence_ids: ["1_0"], question_type: "simple_factual", split: "test" },
    ], { db });
  });

  it("stores answer metrics, groundedness, stage latencies with stubs", async () => {
    const out = await runEvaluation({
      methods: "A", split: "test", topK: 2, db,
      retrieve: stubRetrieveFactory(CORPUS),
      generateAnswers: true,
      generateFn: async () => "The fee is 500 rupees [1_0].",
      judgeFetchFn: async () => ({ ok: true, json: async () => ({ response: '{"correct": true, "reason": "matches"}' }) }),
      groundJudgeFn: async (claim, texts) => ({ supported: texts.some((t) => t.includes("500")), reason: "stub" }),
    });
    const r = out.results.A[0];
    assert.equal(r.answer_correct_judge, 1);
    assert.ok(Math.abs(r.answer_token_f1 - 4 / 9) < 1e-4, `f1=${r.answer_token_f1}`);
    assert.equal(r.grounded_supported_pct, 1);
    assert.equal(r.grounded_unsupported_pct, 0);
    assert.equal(r.citation_support_accuracy, 1);
    assert.ok(typeof r.retrieval_ms === "number" && typeof r.selection_ms === "number" && typeof r.generation_ms === "number");
    assert.ok(r.latency_ms >= r.retrieval_ms);
    const stored = db.prepare("SELECT answer, answer_correct_judge, retrieval_ms FROM evaluation_results").get();
    assert.equal(stored.answer, "The fee is 500 rupees [1_0].");
    assert.equal(stored.answer_correct_judge, 1);
    assert.ok(typeof stored.retrieval_ms === "number");
    assert.ok(typeof out.comparison.A.avgCorrectness === "number");
    assert.ok(typeof out.comparison.A.avgGroundedSupported === "number");
  });

  it("measures consistency over N runs when requested", async () => {
    let calls = 0;
    const out = await runEvaluation({
      methods: "A", split: "test", topK: 2, db,
      retrieve: async () => { calls++; return stubRetrieveFactory(CORPUS)("q", { mode: "dense" }); },
      generateAnswers: true,
      generateFn: async () => "The fee is 500 rupees.",
      consistencyN: 3,
      judgeFetchFn: async () => ({ ok: true, json: async () => ({ response: '{"correct": true, "reason": "ok"}\nscore: 1' }) }),
      groundJudgeFn: async () => ({ supported: true, reason: "stub" }),
    });
    assert.equal(calls, 3);
    assert.equal(out.results.A[0].answer_agreement, 1);
    assert.equal(out.results.A[0].retrieval_stability, 1);
  });

  it("leaves answer metrics null without generated answers", async () => {
    const out = await runEvaluation({ methods: "A", split: "test", topK: 2, db, retrieve: stubRetrieveFactory(CORPUS) });
    const r = out.results.A[0];
    assert.equal(r.answer_correct_judge, null);
    assert.equal(r.grounded_supported_pct, null);
    assert.equal(r.answer_agreement, null);
  });
});

// ------------------------------------------------- manual review ---

describe("manual-review export", () => {
  async function seededDb() {
    const db = memDb();
    importDataset([
      { query: "Fee?", expected_answer: "500 rupees", required_evidence_ids: ["1_0"], question_type: "simple_factual", split: "test" },
      { query: "Due?", expected_answer: "September", required_evidence_ids: ["1_1"], question_type: "simple_factual", split: "test" },
    ], { db });
    await runEvaluation({
      methods: "A", split: "test", topK: 2, db,
      retrieve: stubRetrieveFactory(CORPUS),
      generateAnswers: true,
      generateFn: async (q) => `Answer to ${q} [1_0].`,
      groundJudgeFn: async () => ({ supported: true, reason: "stub" }),
      judgeFetchFn: async () => ({ ok: true, json: async () => ({ response: '{"correct": true, "reason": "ok"}\nscore: 1' }) }),
    });
    return db;
  }

  it("samples deterministically, caps at n, and renders markdown", async () => {
    const db = await seededDb();
    const runId = db.prepare("SELECT id FROM evaluation_runs").get().id;
    const fetchChunks = async (ids) => Object.fromEntries(ids.map((id) => [id, { text: `text of ${id}` }]));
    const a = await sampleReview({ db, runId, n: 20, seed: 7, fetchChunks });
    const b = await sampleReview({ db, runId, n: 20, seed: 7, fetchChunks });
    assert.deepEqual(a, b);
    assert.equal(a.sampled.length, 2);
    const one = await sampleReview({ db, runId, n: 1, seed: 7, fetchChunks });
    assert.equal(one.sampled.length, 1);
    const s = a.sampled[0];
    assert.ok(s.answer && s.selected_chunks.length > 0 && s.judge);
    assert.equal(s.selected_chunks[0].text, `text of ${s.selected_chunks[0].chunk_id}`);
    const md = reviewMarkdown(a);
    assert.ok(md.includes("Manual review") && md.includes(s.answer) && md.includes("Your verdict:"));
  });
});
