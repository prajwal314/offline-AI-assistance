/**
 * Unit tests for Change 1 (retrieval): BM25, RRF fusion, mode switching.
 * Run with: npm test  (node --test tests/)
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const { tokenize, BM25Index } = require("../src/retrieval/bm25");
const { reciprocalRankFusion, DEFAULT_RRF_K } = require("../src/retrieval/fusion");
const {
  retrieve,
  getRetrievalMode,
  setRetrieverDeps,
  resetRetrieverDeps,
  VALID_MODES,
} = require("../src/retrieval");

// ---------------------------------------------------------------- BM25 ---

describe("bm25 tokenize: preserves IDs, codes and names", () => {
  it("keeps exact numeric IDs", () => {
    assert.deepEqual(tokenize("26084285"), ["26084285"]);
  });

  it("keeps single-character tokens (no aggressive min-length strip)", () => {
    const toks = tokenize("vitamin A section 2");
    assert.ok(toks.includes("a"), `expected "a" in ${JSON.stringify(toks)}`);
    assert.ok(toks.includes("2"), `expected "2" in ${JSON.stringify(toks)}`);
  });

  it("does not strip stopwords", () => {
    const toks = tokenize("to be or not to be");
    assert.ok(toks.includes("to"), `expected "to" in ${JSON.stringify(toks)}`);
    assert.ok(toks.includes("be"), `expected "be" in ${JSON.stringify(toks)}`);
  });

  it("indexes compound codes whole and split", () => {
    const toks = tokenize("CAT-2026");
    assert.ok(toks.includes("cat-2026"), `expected whole code, got ${JSON.stringify(toks)}`);
    assert.ok(toks.includes("cat"), `expected part, got ${JSON.stringify(toks)}`);
    assert.ok(toks.includes("2026"), `expected part, got ${JSON.stringify(toks)}`);
  });

  it("is case-insensitive for names", () => {
    assert.deepEqual(tokenize("CHETASHREE"), ["chetashree"]);
  });

  it("returns [] for empty input", () => {
    assert.deepEqual(tokenize(""), []);
    assert.deepEqual(tokenize(null), []);
  });
});

describe("BM25Index scoring", () => {
  const docs = [
    { id: "a", text: "applicant user id 26084285 chetashree bhavsar", metadata: {} },
    { id: "b", text: "general information about admission process and schedule", metadata: {} },
    { id: "c", text: "CAT-2026 eligibility criteria for candidates", metadata: {} },
  ];

  it("ranks the exact-ID chunk first", () => {
    const idx = new BM25Index(docs);
    const res = idx.scoreQuery(tokenize("26084285"));
    assert.ok(res.length > 0);
    assert.equal(res[0].doc.id, "a");
  });

  it("matches compound codes", () => {
    const idx = new BM25Index(docs);
    const res = idx.scoreQuery(tokenize("CAT-2026"));
    assert.ok(res.length > 0);
    assert.equal(res[0].doc.id, "c");
  });

  it("matches names", () => {
    const idx = new BM25Index(docs);
    const res = idx.scoreQuery(tokenize("chetashree"));
    assert.ok(res.length > 0);
    assert.equal(res[0].doc.id, "a");
  });

  it("returns [] for empty query or empty corpus", () => {
    const idx = new BM25Index(docs);
    assert.deepEqual(idx.scoreQuery([]), []);
    assert.deepEqual(idx.scoreQuery(tokenize("zzz-no-such-term-qqq")), []);
    assert.deepEqual(new BM25Index([]).scoreQuery(tokenize("hello")), []);
  });

  it("round-trips through toJSON/fromJSON", () => {
    const idx = new BM25Index(docs);
    const revived = BM25Index.fromJSON(JSON.parse(JSON.stringify(idx.toJSON())));
    const q = tokenize("26084285");
    assert.equal(revived.scoreQuery(q)[0].doc.id, idx.scoreQuery(q)[0].doc.id);
  });
});

// ------------------------------------------------------------------ RRF ---

function cand(id, score, rank) {
  return { chunkId: id, id, text: `text-${id}`, score, rank, metadata: {} };
}

describe("reciprocalRankFusion (k=60 default)", () => {
  it("has default k=60", () => {
    assert.equal(DEFAULT_RRF_K, 60);
  });

  it("ranks an item present in both lists above single-list items", () => {
    const dense = [cand("a", 0.9, 1), cand("b", 0.5, 2)];
    const bm25 = [cand("b", 0.9, 1), cand("c", 0.5, 2)];
    const fused = reciprocalRankFusion(dense, bm25);
    assert.equal(fused[0].chunkId, "b");
  });

  it("keeps original per-method scores and ranks", () => {
    const dense = [cand("a", 0.9, 1)];
    const bm25 = [{ chunkId: "a", id: "a", text: "text-a", score: 0.7, rank: 2, metadata: {}, rawBm25Score: 3.14 }];
    const fused = reciprocalRankFusion(dense, bm25);
    assert.equal(fused.length, 1);
    assert.equal(fused[0].denseScore, 0.9);
    assert.equal(fused[0].denseRank, 1);
    assert.equal(fused[0].bm25Score, 0.7);
    assert.equal(fused[0].bm25Rank, 2);
    assert.equal(fused[0].rawBm25Score, 3.14);
  });

  it("marks missing-method ranks as null with zero score", () => {
    const fused = reciprocalRankFusion([cand("a", 0.9, 1)], [cand("b", 0.8, 1)]);
    const a = fused.find((x) => x.chunkId === "a");
    const b = fused.find((x) => x.chunkId === "b");
    assert.equal(a.bm25Rank, null);
    assert.equal(a.bm25Score, 0);
    assert.equal(b.denseRank, null);
    assert.equal(b.denseScore, 0);
  });

  it("k is configurable and changes raw rrf scores", () => {
    const dense = [cand("a", 0.9, 1)];
    const bm25 = [cand("a", 0.9, 1)];
    const small = reciprocalRankFusion(dense, bm25, { k: 1 });
    const large = reciprocalRankFusion(dense, bm25, { k: 60 });
    assert.notEqual(small[0].rrfScore, large[0].rrfScore);
    // 1/(1+1) + 1/(1+1) = 1.0
    assert.ok(Math.abs(small[0].rrfScore - 1.0) < 1e-9);
  });

  it("assigns final rank in rrf order with score === rrfScore", () => {
    const fused = reciprocalRankFusion([cand("a", 0.9, 1)], [cand("b", 0.9, 1)]);
    fused.forEach((c, i) => {
      assert.equal(c.rank, i + 1);
      assert.equal(c.score, c.rrfScore);
    });
  });

  it("handles empty inputs", () => {
    assert.deepEqual(reciprocalRankFusion([], []), []);
    assert.equal(reciprocalRankFusion([cand("a", 1, 1)], []).length, 1);
    assert.equal(reciprocalRankFusion([], [cand("a", 1, 1)]).length, 1);
  });
});

// ------------------------------------------------------- mode switching ---

describe("retriever entry point: mode switching", () => {
  const OLD_ENV = process.env.RETRIEVAL_MODE;

  beforeEach(() => {
    resetRetrieverDeps();
  });

  afterEach(() => {
    resetRetrieverDeps();
    if (OLD_ENV === undefined) delete process.env.RETRIEVAL_MODE;
    else process.env.RETRIEVAL_MODE = OLD_ENV;
  });

  it("exposes only dense and hybrid modes", () => {
    assert.deepEqual(VALID_MODES, ["dense", "hybrid", "hybrid_rerank", "hybrid_rerank_meta", "adaptive"]);
  });

  it("defaults to dense when env is unset or invalid", () => {
    delete process.env.RETRIEVAL_MODE;
    assert.equal(getRetrievalMode(), "dense");
    process.env.RETRIEVAL_MODE = "bogus-mode";
    assert.equal(getRetrievalMode(), "dense");
  });

  it("reads RETRIEVAL_MODE=hybrid from env", () => {
    process.env.RETRIEVAL_MODE = "hybrid";
    assert.equal(getRetrievalMode(), "hybrid");
  });

  it("explicit mode option overrides env", () => {
    process.env.RETRIEVAL_MODE = "dense";
    assert.equal(getRetrievalMode("hybrid"), "hybrid");
    process.env.RETRIEVAL_MODE = "hybrid";
    assert.equal(getRetrievalMode("dense"), "dense");
  });

  it("retrieve() in dense mode calls only the dense fn", async () => {
    delete process.env.RETRIEVAL_MODE;
    let denseCalls = 0;
    let bm25Calls = 0;
    setRetrieverDeps({
      denseFn: async (q, topK) => {
        denseCalls++;
        return [cand("a", 0.9, 1)].slice(0, topK);
      },
      bm25Fn: async () => {
        bm25Calls++;
        return [cand("b", 0.9, 1)];
      },
    });
    const hits = await retrieve("hello", { mode: "dense", topK: 5 });
    assert.equal(denseCalls, 1);
    assert.equal(bm25Calls, 0);
    assert.equal(hits.length, 1);
    assert.equal(hits[0].chunkId, "a");
  });

  it("retrieve() in hybrid mode fuses both lists", async () => {
    setRetrieverDeps({
      denseFn: async () => [cand("a", 0.9, 1)],
      bm25Fn: async () => [cand("a", 0.9, 1), cand("b", 0.5, 2)],
    });
    const hits = await retrieve("hello", { mode: "hybrid", topK: 2 });
    // "a" is in both lists so it must come first.
    assert.equal(hits[0].chunkId, "a");
    assert.equal(hits.length, 2);
    assert.equal(hits[0].denseRank, 1);
    assert.equal(hits[0].bm25Rank, 1);
  });

  it("retrieve() defaults to dense (current behaviour unchanged)", async () => {
    delete process.env.RETRIEVAL_MODE;
    let bm25Calls = 0;
    setRetrieverDeps({
      denseFn: async () => [cand("a", 0.9, 1)],
      bm25Fn: async () => {
        bm25Calls++;
        return [];
      },
    });
    await retrieve("hello", { topK: 5 });
    assert.equal(bm25Calls, 0);
  });
});
