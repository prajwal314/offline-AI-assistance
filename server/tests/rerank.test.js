/**
 * Unit tests for the optional rerank stage (server/src/retrieval/rerank.js)
 * and the hybrid_rerank retriever mode.
 * Run with: npm test
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  rerank,
  resolveBackend,
  DEFAULT_BACKEND,
} = require("../src/retrieval/rerank");
const {
  retrieve,
  getRetrievalMode,
  setRetrieverDeps,
  resetRetrieverDeps,
} = require("../src/retrieval");

function cand(id, score, rank, text) {
  return { chunkId: id, id, text: text ?? `unrelated filler words ${id}`, score, rank, metadata: {} };
}

// Silence expected fallback warnings, but record them.
let warnings;
const origWarn = console.warn;
function captureWarnings() {
  warnings = [];
  console.warn = (...args) => warnings.push(args.join(" "));
}
function restoreWarnings() {
  console.warn = origWarn;
}

// ---------------------------------------------------------------- backend ---

describe("rerank backend resolution", () => {
  it("defaults to lexical (always offline)", () => {
    assert.equal(DEFAULT_BACKEND, "lexical");
    assert.equal(resolveBackend(undefined), "lexical");
  });

  it("accepts cross-encoder and auto, rejects unknown", () => {
    assert.equal(resolveBackend("cross-encoder"), "cross-encoder");
    assert.equal(resolveBackend("auto"), "auto");
    assert.equal(resolveBackend("bogus"), "lexical");
  });
});

// ------------------------------------------------------- lexical rerank ---

describe("lexical rerank", () => {
  it("orders the query-relevant candidate first", async () => {
    const cands = [
      cand("a", 0.5, 2, "unrelated filler words about weather"),
      cand("b", 0.5, 1, "cat 2026 eligibility criteria for candidates"),
    ];
    const { results, backend, fallback, latencyMs } = await rerank("cat 2026 eligibility", cands, {
      topK: 2,
      backend: "lexical",
    });
    assert.equal(results[0].chunkId, "b");
    assert.equal(backend, "lexical");
    assert.equal(fallback, false);
    assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0);
  });

  it("keeps per-stage fields and sets rerankScore/rerankRank", async () => {
    const cands = [{ chunkId: "a", id: "a", text: "cat eligibility", score: 0.9, rank: 1, metadata: {}, denseScore: 0.9, denseRank: 1, bm25Score: 0.4, bm25Rank: 3 }];
    const { results } = await rerank("cat eligibility", cands, { topK: 1, backend: "lexical" });
    assert.equal(results[0].denseScore, 0.9);
    assert.equal(results[0].bm25Rank, 3);
    assert.ok(typeof results[0].rerankScore === "number");
    assert.equal(results[0].rerankRank, 1);
  });

  it("slices to topK and handles empty input", async () => {
    const cands = [cand("a", 0.9, 1, "cat"), cand("b", 0.8, 2, "cat dog"), cand("c", 0.7, 3, "cat dog bird")];
    const { results } = await rerank("cat", cands, { topK: 2, backend: "lexical" });
    assert.equal(results.length, 2);
    const empty = await rerank("cat", [], { topK: 5 });
    assert.deepEqual(empty.results, []);
    assert.ok(Number.isFinite(empty.latencyMs));
  });
});

// ------------------------------------------- cross-encoder fallback (spec) ---

describe("cross-encoder failure: graceful fallback to hybrid order", () => {
  beforeEach(captureWarnings);
  afterEach(restoreWarnings);

  it("missing package warns and preserves input (hybrid) order", async () => {
    const cands = [cand("a", 0.9, 1), cand("b", 0.8, 2)];
    const { results, fallback, latencyMs } = await rerank("anything", cands, {
      topK: 2,
      backend: "cross-encoder",
    });
    assert.equal(fallback, true);
    assert.deepEqual(results.map((r) => r.chunkId), ["a", "b"]);
    assert.ok(warnings.some((w) => w.includes("hybrid order")));
    assert.ok(Number.isFinite(latencyMs) && latencyMs >= 0);
  });

  it("auto backend falls back to lexical (still reorders)", async () => {
    const cands = [
      cand("a", 0.5, 1, "unrelated filler words about weather"),
      cand("b", 0.5, 2, "cat 2026 eligibility criteria for candidates"),
    ];
    const { results, backend, fallback } = await rerank("cat 2026 eligibility", cands, {
      topK: 2,
      backend: "auto",
    });
    assert.equal(fallback, true);
    assert.equal(backend, "lexical");
    assert.equal(results[0].chunkId, "b");
  });

  it("stubbed cross-encoder success orders by model scores", async () => {
    const cands = [cand("a", 0.9, 1), cand("b", 0.1, 2)];
    const { results, backend, fallback } = await rerank("q", cands, {
      topK: 2,
      backend: "cross-encoder",
      crossEncoderFn: async () => [0.1, 0.99],
    });
    assert.equal(fallback, false);
    assert.equal(backend, "cross-encoder");
    assert.deepEqual(results.map((r) => r.chunkId), ["b", "a"]);
  });

  it("stubbed cross-encoder throw falls back to hybrid order", async () => {
    const cands = [cand("a", 0.9, 1), cand("b", 0.8, 2)];
    const { results, fallback } = await rerank("q", cands, {
      topK: 2,
      backend: "cross-encoder",
      crossEncoderFn: async () => { throw new Error("boom"); },
    });
    assert.equal(fallback, true);
    assert.deepEqual(results.map((r) => r.chunkId), ["a", "b"]);
  });
});

// ------------------------------------------------------- hybrid_rerank ---

describe("retriever hybrid_rerank mode", () => {
  const OLD_ENV = process.env.RETRIEVAL_MODE;

  beforeEach(() => {
    resetRetrieverDeps();
    captureWarnings();
  });

  afterEach(() => {
    resetRetrieverDeps();
    restoreWarnings();
    if (OLD_ENV === undefined) delete process.env.RETRIEVAL_MODE;
    else process.env.RETRIEVAL_MODE = OLD_ENV;
  });

  it("is a valid mode behind RETRIEVAL_MODE", () => {
    process.env.RETRIEVAL_MODE = "hybrid_rerank";
    assert.equal(getRetrievalMode(), "hybrid_rerank");
    assert.equal(getRetrievalMode("hybrid_rerank"), "hybrid_rerank");
  });

  it("runs hybrid -> rerank topN -> topK and records latency meta", async () => {
    let rerankInput = null;
    setRetrieverDeps({
      denseFn: async (q, topK) => [cand("a", 0.9, 1), cand("b", 0.8, 2)].slice(0, topK),
      bm25Fn: async (q, topK) => [cand("b", 0.9, 1), cand("c", 0.8, 2)].slice(0, topK),
      rerankFn: async (q, pool, o) => {
        rerankInput = pool.map((c) => c.chunkId);
        return { results: pool.slice(0, o.topK), latencyMs: 7, backend: "stub", fallback: false };
      },
    });
    const hits = await retrieve("q", { mode: "hybrid_rerank", topK: 1, rerankTopN: 3 });
    assert.equal(hits.length, 1);
    // Fused pool of 3 (a, b, c) reaches the reranker.
    assert.deepEqual(rerankInput, ["b", "a", "c"]);
    assert.equal(hits.meta.mode, "hybrid_rerank");
    assert.equal(hits.meta.rerankLatencyMs, 7);
    assert.equal(hits.meta.rerankBackend, "stub");
    assert.equal(hits.meta.rerankFallback, false);
  });

  it("end-to-end with the real lexical reranker", async () => {
    setRetrieverDeps({
      denseFn: async () => [cand("a", 0.9, 1, "unrelated filler words about weather")],
      bm25Fn: async () => [cand("b", 0.2, 1, "cat 2026 eligibility criteria for candidates")],
    });
    const hits = await retrieve("cat 2026 eligibility", { mode: "hybrid_rerank", topK: 2 });
    assert.equal(hits.length, 2);
    assert.equal(hits[0].chunkId, "b");
    assert.ok(Number.isFinite(hits.meta.rerankLatencyMs));
    assert.equal(hits.meta.rerankFallback, false);
  });

  it("array contract unchanged (length/index/iteration)", async () => {
    setRetrieverDeps({
      denseFn: async () => [cand("a", 0.9, 1)],
      bm25Fn: async () => [],
    });
    const hits = await retrieve("q", { mode: "hybrid_rerank", topK: 5 });
    assert.equal(hits.length, 1);
    assert.equal(hits[0].chunkId, "a");
    assert.deepEqual(hits.map((h) => h.chunkId), ["a"]);
  });
});
