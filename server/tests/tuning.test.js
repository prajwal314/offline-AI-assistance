/**
 * Tests for tuning (validation-only), ablations, stats, and honest reporting.
 * All retrieval is stubbed; no Ollama/Chroma needed.
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { tuneWeights, reportOnTest, candidateTrials } = require("../src/evaluation/tune");
const { runAblations, ABLATIONS } = require("../src/evaluation/ablate");
const { mean, std, summarizeDetailed, breakdownByType } = require("../src/evaluation/stats");
const { buildReport, notBeatingNotes } = require("../src/evaluation/report");

function chunk(id, text, extra = {}) {
  return { chunkId: id, id, text, metadata: {}, denseScore: 0.5, bm25Score: 0.5, ...extra };
}

// Pool where semantic-heavy weights win and keyword-heavy weights lose (topK=1).
const POOL = [
  chunk("a", "application fee payment", { denseScore: 0.9, bm25Score: 0.1 }),
  chunk("b", "deadline schedule calendar", { denseScore: 0.1, bm25Score: 0.9 }),
];
const QUESTIONS = [
  { id: 1, query: "What is the fee?", required_evidence_ids: JSON.stringify(["a"]), question_type: "simple_factual", split: "validation" },
  { id: 2, query: "When is it due?", required_evidence_ids: JSON.stringify(["b"]), question_type: "simple_factual", split: "validation" },
];
const stubRetrieve = async () => POOL.map((c) => ({ ...c }));

describe("tuning guardrails and search", () => {
  it("refuses to tune on the test split", async () => {
    await assert.rejects(tuneWeights({ split: "test", questions: QUESTIONS }), /refusing to tune on the test split/);
  });

  it("random search is seeded and reproducible; grid includes defaults", () => {
    const a = candidateTrials({ search: "random", trials: 10, seed: 7 }).map((t) => JSON.stringify(t));
    const b = candidateTrials({ search: "random", trials: 10, seed: 7 }).map((t) => JSON.stringify(t));
    assert.deepEqual(a, b);
    const grid = candidateTrials({ search: "grid" });
    assert.ok(grid.length > 10, `grid should be non-trivial, got ${grid.length}`);
    assert.ok(grid.some((t) => t.weights && Math.abs(t.weights.semantic - 0.4) < 1e-9));
  });

  it("tunes on validation pools and reports the winner on test pools separately", async () => {
    const tuned = await tuneWeights({ split: "validation", questions: QUESTIONS, retrieve: stubRetrieve, trials: 12, seed: 3, topK: 1 });
    assert.equal(tuned.split, "validation");
    assert.ok(tuned.best.objective > 0, "best should beat zero");
    // Semantic-leaning configs must outrank keyword-only ones on this fixture.
    const kwOnly = tuned.trials.find((t) => t.config.weights && t.config.weights.keyword === 1);
    if (kwOnly) assert.ok(tuned.best.objective > kwOnly.objective);
    const testQs = QUESTIONS.map((q) => ({ ...q, split: "test" }));
    const rep = await reportOnTest(tuned.best.config, { split: "test", questions: testQs, retrieve: stubRetrieve, topK: 1 });
    assert.equal(rep.split, "test");
    assert.ok(typeof rep.objective === "number");
  });
});

describe("ablations", () => {
  it("covers all seven removals with variant-minus-baseline deltas", async () => {
    const out = await runAblations({ questions: QUESTIONS, retrieve: stubRetrieve, topK: 1 });
    assert.deepEqual(out.variants.map((v) => v.removed).sort(),
      ["conflict", "coverage", "keyword", "metadata", "redundancy", "semantic", "temporal"]);
    assert.equal(out.variants.length, ABLATIONS.length);
    for (const v of out.variants) {
      for (const k of ["coverage", "recall", "mrr", "ndcg", "precision"]) {
        assert.ok(typeof v.metrics[k] === "number", `${v.name}.${k} should be a number`);
        if (v.deltas[k] !== null) assert.ok(typeof v.deltas[k] === "number");
      }
    }
    // Sign check on a controlled fixture: both chunks lexically cover r1, so
    // selection cannot rescue a bad score — zeroing the decisive feature hurts.
    const b2 = { ...POOL[1], text: "deadline schedule calendar fee" };
    const oneQ = [{ id: 1, query: "What is the fee?", required_evidence_ids: JSON.stringify(["a"]), question_type: "simple_factual", split: "validation" }];
    const oneRetrieve = async () => [POOL[0], b2].map((c) => ({ ...c }));
    const one = await runAblations({ questions: oneQ, retrieve: oneRetrieve, topK: 1 });
    assert.equal(one.baseline.coverage, 1);
    const noSem = one.variants.find((v) => v.removed === "semantic");
    assert.equal(noSem.metrics.coverage, 0);
    assert.equal(noSem.deltas.coverage, -1);
  });
});

describe("stats and honest reporting", () => {
  it("mean/std/breakdown behave on edge cases", () => {
    assert.equal(mean([]), null);
    assert.equal(std([]), null);
    assert.equal(std([0.5, 0.5]), 0);
    assert.ok(Math.abs(std([0, 1]) - 0.5) < 1e-9, "population std of {0,1} is 0.5");
    const bd = breakdownByType([
      { question_type: "simple_factual", precision_at_k: 1 },
      { question_type: "multi_chunk", precision_at_k: 0 },
    ]);
    assert.equal(bd.simple_factual.n, 1);
    assert.equal(bd.multi_chunk.metrics.precision.mean, 0);
    assert.equal(summarizeDetailed([]).precision.n, 0);
  });

  it("flags every case where the proposed method does NOT beat the baseline", () => {
    const mk = (p, r) => ({ precision_at_k: p, recall_at_k: r, mrr: p, ndcg: p, evidence_coverage: p, redundancy_rate: 0, conflict_correct: null, latency_ms: 10, context_tokens: 5, question_type: "simple_factual" });
    const notes = notBeatingNotes({ A: [mk(0.8, 0.8)], E: [mk(0.5, 0.9)] }, "A");
    assert.ok(notes.some((n) => n.includes("E does NOT beat A on P@K")), notes.join("\n"));
    assert.ok(!notes.some((n) => n.includes("R@K") && n.includes("does NOT beat")), "recall improved — must not be flagged");
    const clean = notBeatingNotes({ A: [mk(0.5, 0.5)], E: [mk(0.9, 0.9)] }, "A");
    assert.deepEqual(clean, []);
  });

  it("final report has tables, deficits section, and no winner language", () => {
    const row = (p) => ({ question_id: 1, precision_at_k: p, recall_at_k: p, mrr: p, ndcg: p, evidence_coverage: p, redundancy_rate: 0, conflict_correct: null, latency_ms: 10, context_tokens: 5 });
    const md = buildReport({
      resultsByMethod: { A: [row(0.8)], E: [row(0.5)] },
      questions: [{ id: 1, question_type: "simple_factual" }],
      modes: { A: "dense", E: "adaptive" },
      baseline: "A",
      meta: { split: "test", topK: 1, datasetVersion: "v1" },
    });
    assert.ok(md.includes("## A–E comparison") && md.includes("## Honest notes"));
    assert.ok(md.includes("does NOT beat"), "deficit must be stated plainly");
    assert.ok(!/winner|best method|recommended|champion/i.test(md), "no winner language allowed");
  });
});
