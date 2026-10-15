/**
 * Unit tests for Change 3 (scoring): normalization, weights, explanations,
 * hard filters, and the hybrid_rerank_meta / adaptive modes.
 * Run with: npm test
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const {
  FEATURES,
  DEFAULT_WEIGHTS,
  normalizeWeights,
  queryDependentWeights,
  setWeightFunction,
  resetWeightFunction,
  resolveWeights,
} = require("../src/scoring/weights");
const {
  clamp01,
  parseQueryDates,
  parseQueryVersions,
  extractSemantic,
  extractKeyword,
  extractMetadata,
  extractTemporal,
  extractFeatures,
} = require("../src/scoring/features");
const { applyHardFilters, scoreCandidates } = require("../src/scoring/scorer");

function cand(id, text, extra = {}) {
  return { chunkId: id, id, text, metadata: {}, ...extra };
}

// ---------------------------------------------------------- normalization ---

describe("feature normalization (0-1)", () => {
  it("clamp01 clamps and falls back", () => {
    assert.equal(clamp01(2), 1);
    assert.equal(clamp01(-1), 0);
    assert.equal(clamp01(0.4), 0.4);
    assert.equal(clamp01(NaN, 0.5), 0.5);
    assert.equal(clamp01("x"), 0);
  });

  it("semantic: denseScore passthrough, distance mapping, neutral default", () => {
    assert.equal(extractSemantic({ denseScore: 0.9 }).value, 0.9);
    assert.equal(extractSemantic({ distance: 0 }).value, 1);
    assert.equal(extractSemantic({ distance: 2 }).value, 0);
    assert.equal(extractSemantic({ distance: 1 }).value, 0.5);
    assert.equal(extractSemantic({}).value, 0.5);
  });

  it("keyword: normalized passthrough, saturated raw, zero default", () => {
    assert.equal(extractKeyword({ bm25Score: 0.7 }).value, 0.7);
    assert.equal(extractKeyword({ sparseScore: 0.4 }).value, 0.4);
    const sat = extractKeyword({ rawBm25Score: 9 }).value;
    assert.ok(sat > 0 && sat < 1, `expected (0,1), got ${sat}`);
    assert.equal(extractKeyword({}).value, 0);
  });

  it("metadata: match/mismatch/unknown/text-mention/neutral", () => {
    assert.equal(extractMetadata("q", cand("a", "t"), {}).value, 0.5);
    const hit = extractMetadata("q", cand("a", "t", { metadata: { department: "Finance" } }), { department: "finance" });
    assert.equal(hit.value, 1);
    const miss = extractMetadata("q", cand("a", "t", { metadata: { department: "HR" } }), { department: "finance" });
    assert.equal(miss.value, 0);
    const unknown = extractMetadata("q", cand("a", "plain text"), { department: "finance" });
    assert.equal(unknown.value, 0.5);
    const weak = extractMetadata("q", cand("a", "issued by the finance office"), { department: "finance" });
    assert.equal(weak.value, 0.6);
  });

  it("temporal: neutral without signals, status and date rules", () => {
    assert.equal(extractTemporal("hello world", cand("a", "t"), {}).value, 0.5);
    const active = extractTemporal("q", cand("a", "t", { metadata: { status: "active" } }), {});
    const stale = extractTemporal("q", cand("a", "t", { metadata: { status: "superseded" } }), {});
    assert.ok(active.value > stale.value, `${active.value} should exceed ${stale.value}`);
    const future = extractTemporal("version as of 2022-06-01", cand("a", "t", { metadata: { status: "active", effectiveDate: "2024-01-01" } }), {});
    assert.ok(future.value < active.value, `future-effective chunk should score lower`);
    const same = extractTemporal("q", cand("a", "t", { metadata: { status: "active", version: "v1.2" } }), { version: "v1.2" });
    assert.equal(same.value, 1);
  });

  it("parses date and version mentions in queries", () => {
    assert.deepEqual(parseQueryDates("as of 2024-01-15").map((d) => d.iso), ["2024-01-15"]);
    assert.deepEqual(parseQueryDates("dated 15/01/2024").map((d) => d.iso), ["2024-01-15"]);
    assert.ok(parseQueryDates("the 2023 policy").some((d) => d.iso === "2023-01-01"));
    assert.deepEqual(parseQueryDates("no dates here"), []);
    assert.equal(parseQueryVersions("see v2.1 please")[0].parts.join("."), "2.1");
    assert.deepEqual(parseQueryVersions("no versions"), []);
  });

  it("every extracted feature is within [0, 1]", () => {
    const { features } = extractFeatures("CAT-2026 v2.0 as of 2024-01-01 finance", cand("a", "CAT-2026 finance text", {
      metadata: { status: "draft", effectiveDate: "2023-05-01", version: "v1.0", department: "Finance", authorityScore: 0.9 },
      denseScore: 5, // out-of-range input must be clamped, not leak
      rawBm25Score: 42,
    }), { department: "Finance", asOfDate: "2024-06-01" });
    for (const f of FEATURES) {
      assert.ok(features[f] >= 0 && features[f] <= 1, `${f}=${features[f]} out of range`);
    }
  });
});

// ------------------------------------------------------- weights (A + B) ---

describe("weights: fixed baseline and query-dependent rules", () => {
  afterEach(resetWeightFunction);

  it("DEFAULT_WEIGHTS covers all features and sums to 1", () => {
    assert.deepEqual(Object.keys(DEFAULT_WEIGHTS).sort(), [...FEATURES].sort());
    const sum = FEATURES.reduce((s, f) => s + DEFAULT_WEIGHTS[f], 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `sum=${sum}`);
  });

  it("normalizeWeights rescales, clamps negatives, equal-splits zero", () => {
    assert.deepEqual(normalizeWeights({ semantic: 2, keyword: 2, metadata: 0, temporal: 0 }), { semantic: 0.5, keyword: 0.5, metadata: 0, temporal: 0 });
    const neg = normalizeWeights({ semantic: -5, keyword: 1, metadata: 0, temporal: 0 });
    assert.equal(neg.semantic, 0);
    assert.equal(neg.keyword, 1);
    assert.deepEqual(normalizeWeights({ semantic: 0, keyword: 0, metadata: 0, temporal: 0 }), { semantic: 0.25, keyword: 0.25, metadata: 0.25, temporal: 0.25 });
  });

  it("ID/code queries raise the keyword share vs baseline", () => {
    const base = resolveWeights("general question", { weightMode: "adaptive" }).weights;
    const idq = resolveWeights("applicant 26084285 CAT-2026", { weightMode: "adaptive" }).weights;
    assert.ok(idq.keyword > base.keyword, `keyword ${idq.keyword} should exceed ${base.keyword}`);
    const sum = FEATURES.reduce((s, f) => s + idq[f], 0);
    assert.ok(Math.abs(sum - 1) < 1e-3, `renormalized sum=${sum}`);
  });

  it("date/version mentions raise the temporal share", () => {
    const base = resolveWeights("general question", { weightMode: "adaptive" }).weights;
    const dated = resolveWeights("what changed on 2024-01-01 in v2.0?", { weightMode: "adaptive" }).weights;
    assert.ok(dated.temporal > base.temporal, `temporal ${dated.temporal} should exceed ${base.temporal}`);
  });

  it("fixed mode ignores query signals; custom fn is replaceable", () => {
    const fixed = resolveWeights("applicant 26084285 on 2024-01-01", { weightMode: "fixed" });
    assert.deepEqual(fixed.weights, normalizeWeights(DEFAULT_WEIGHTS));
    assert.equal(fixed.source, "fixed");
    setWeightFunction(() => ({ semantic: 1, keyword: 1, metadata: 1, temporal: 1 }));
    const custom = resolveWeights("q", { weightMode: "adaptive" });
    assert.equal(custom.source, "custom");
    assert.deepEqual(custom.weights, { semantic: 0.25, keyword: 0.25, metadata: 0.25, temporal: 0.25 });
    resetWeightFunction();
    assert.equal(resolveWeights("q", { weightMode: "adaptive" }).source, "adaptive");
  });
});

// ------------------------------------------------------------ explanations ---

describe("score breakdown and explanations", () => {
  it("returns per-feature breakdown matching S(c|q)", () => {
    const c = cand("a", "CAT-2026 eligibility", { denseScore: 0.8, bm25Score: 0.6 });
    const [scored] = scoreCandidates("CAT-2026 eligibility", [c], { weightMode: "fixed" });
    const expect = FEATURES.reduce((s, f) => s + scored.weights[f] * scored.features[f], 0);
    assert.ok(Math.abs(scored.evidenceScore - expect) < 1e-3);
    assert.deepEqual(Object.keys(scored.features).sort(), [...FEATURES].sort());
  });

  it("explanation names the score, features, weight source and boost reason", () => {
    const [scored] = scoreCandidates("applicant 26084285", [cand("a", "applicant 26084285", { denseScore: 0.8 })], { weightMode: "adaptive" });
    assert.ok(scored.explanation.includes("adaptive"), scored.explanation);
    for (const f of FEATURES) assert.ok(scored.explanation.includes(f), `missing ${f}: ${scored.explanation}`);
    assert.ok(scored.explanation.includes("keyword boosted"), scored.explanation);
  });

  it("explanation notes adverse temporal facts", () => {
    const [scored] = scoreCandidates("policy as of 2022-06-01", [
      cand("a", "old policy", { metadata: { status: "superseded", effectiveDate: "2024-01-01" }, denseScore: 0.9 }),
    ], { weightMode: "fixed" });
    assert.ok(scored.explanation.includes("superseded"), scored.explanation);
    assert.ok(scored.explanation.includes("2024-01-01"), scored.explanation);
  });
});

// ------------------------------------------------------------ hard filter ---

describe("authorization-style hard filter (pre-scoring, never a feature)", () => {
  const top = cand("top-secret", "exact match text", { metadata: { documentId: "99" }, denseScore: 1, bm25Score: 1 });

  it("removes excluded candidates before scoring and counts them", () => {
    const res = scoreCandidates("exact match", [top, cand("ok", "other", { metadata: { documentId: "1" }, denseScore: 0.1 })], {
      weightMode: "fixed",
      auth: { allowedDocumentIds: ["1"] },
    });
    assert.deepEqual(res.map((r) => r.chunkId), ["ok"]);
    assert.equal(res.scoringMeta.filteredOut, 1);
  });

  it("no auth passes everything through; filter is not a score feature", () => {
    const res = scoreCandidates("exact match", [top], { weightMode: "fixed" });
    assert.equal(res.length, 1);
    assert.deepEqual(Object.keys(res[0].features).sort(), [...FEATURES].sort());
    assert.ok(!("auth" in res[0].features));
  });
});

// ------------------------------------------------------------------- modes ---

describe("retriever modes hybrid_rerank_meta and adaptive", () => {
  const OLD_ENV = process.env.RETRIEVAL_MODE;
  const { retrieve, getRetrievalMode, setRetrieverDeps, resetRetrieverDeps } = require("../src/retrieval");

  function stubDeps() {
    const mk = (id, text, dense, bm25) => ({ chunkId: id, id, text, score: dense, rank: 1, metadata: {}, denseScore: dense, bm25Score: bm25 });
    setRetrieverDeps({
      denseFn: async () => [mk("a", "cat eligibility rules", 0.9, 0.2), mk("b", "unrelated weather", 0.8, 0.1)],
      bm25Fn: async () => [mk("a", "cat eligibility rules", 0.9, 0.9), mk("b", "unrelated weather", 0.8, 0.0)],
      rerankFn: async (q, pool, o) => ({ results: pool.slice(0, o.topK), latencyMs: 3, backend: "stub", fallback: false }),
    });
  }

  beforeEach(() => { resetRetrieverDeps(); stubDeps(); });
  afterEach(() => {
    resetRetrieverDeps();
    if (OLD_ENV === undefined) delete process.env.RETRIEVAL_MODE;
    else process.env.RETRIEVAL_MODE = OLD_ENV;
  });

  it("hybrid_rerank_meta scores with fixed weights and explains", async () => {
    const hits = await retrieve("cat eligibility", { mode: "hybrid_rerank_meta", topK: 2 });
    assert.equal(hits.meta.mode, "hybrid_rerank_meta");
    assert.equal(hits.meta.weightSource, "fixed");
    for (const h of hits) {
      assert.ok(h.features && h.explanation && typeof h.evidenceScore === "number");
    }
  });

  it("adaptive uses query-dependent weights (ID query shifts keyword up)", async () => {
    const plain = await retrieve("general overview", { mode: "adaptive", topK: 2 });
    const idq = await retrieve("applicant 26084285", { mode: "adaptive", topK: 2 });
    assert.equal(plain.meta.weightSource, "adaptive");
    assert.ok(idq.meta.weights.keyword > plain.meta.weights.keyword,
      `adaptive keyword ${idq.meta.weights.keyword} should exceed ${plain.meta.weights.keyword}`);
  });

  it("both modes are selectable via RETRIEVAL_MODE", () => {
    process.env.RETRIEVAL_MODE = "hybrid_rerank_meta";
    assert.equal(getRetrievalMode(), "hybrid_rerank_meta");
    process.env.RETRIEVAL_MODE = "adaptive";
    assert.equal(getRetrievalMode(), "adaptive");
  });
});
