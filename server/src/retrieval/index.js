/**
 * Retriever entry point (Change 1).
 *
 *   const { retrieve } = require("./retrieval");
 *   const hits = await retrieve(query, { mode: "hybrid", topK: 5 });
 *
 * Modes: "dense" (default), "hybrid", "hybrid_rerank", "hybrid_rerank_meta"
 * and "adaptive". Controlled by RETRIEVAL_MODE env var; an explicit `mode`
 * option overrides the env var. Unknown modes fall back to "dense" so
 * current behaviour is unchanged unless a hybrid mode is opted into.
 *
 * hybrid_rerank: hybrid fusion over a wider pool -> rerank top N -> top K.
 * hybrid_rerank_meta: hybrid -> rerank -> fixed-weight scoring S(c|q) -> top K.
 * adaptive: hybrid -> rerank -> query-dependent-weight scoring S(c|q) -> top K.
 * No claim is made that adaptive weights are better — only experiments
 * will show that.
 * Rerank latency/backend/fallback are attached as `results.meta` (own
 * property on the returned array; invisible to length/index/iteration/JSON)
 * so in-process evaluation can report them without changing the array
 * contract. Each reranked candidate also carries rerankScore/rerankRank.
 *
 * This module is additive: the legacy retrievalDispatcher / retrievalService
 * paths are untouched. No claim is made that hybrid is better — that is
 * measured separately.
 */

const { searchDense } = require("./dense");
const { searchBm25 } = require("./bm25");
const { reciprocalRankFusion, DEFAULT_RRF_K } = require("./fusion");
const { rerank, DEFAULT_RERANK_MODEL } = require("./rerank");
const { scoreCandidates } = require("../scoring/scorer");

const VALID_MODES = ["dense", "hybrid", "hybrid_rerank", "hybrid_rerank_meta", "adaptive"];
const DEFAULT_RERANK_TOP_N = 20;

function getRetrievalMode(overrideMode = null) {
  if (overrideMode && VALID_MODES.includes(String(overrideMode).toLowerCase())) {
    return String(overrideMode).toLowerCase();
  }
  const envMode = String(process.env.RETRIEVAL_MODE || "dense").toLowerCase().trim();
  return VALID_MODES.includes(envMode) ? envMode : "dense";
}

// Dependency-injection hooks so unit tests can stub I/O without Chroma/Ollama.
const deps = {
  denseFn: searchDense,
  bm25Fn: searchBm25,
  rerankFn: rerank,
};

function setRetrieverDeps(next = {}) {
  if (next.denseFn) deps.denseFn = next.denseFn;
  if (next.bm25Fn) deps.bm25Fn = next.bm25Fn;
  if (next.rerankFn) deps.rerankFn = next.rerankFn;
}

function resetRetrieverDeps() {
  deps.denseFn = searchDense;
  deps.bm25Fn = searchBm25;
  deps.rerankFn = rerank;
}

function attachMeta(results, meta) {
  results.meta = meta;
  return results;
}

async function retrieve(query, opts = {}) {
  const mode = getRetrievalMode(opts.mode);
  const topK = Math.max(1, parseInt(opts.topK, 10) || 5);
  const where = opts.where || null;
  const k = optionsK(opts);

  if (mode === "hybrid_rerank") {
    const rerankTopN = Math.max(1, parseInt(opts.rerankTopN, 10) || DEFAULT_RERANK_TOP_N);
    const poolSize = Math.max(rerankTopN, topK * 2, 10);
    const [denseHits, bm25Hits] = await Promise.all([
      deps.denseFn(query, poolSize, where),
      deps.bm25Fn(query, poolSize, where),
    ]);
    const fused = reciprocalRankFusion(denseHits, bm25Hits, { k });
    const pool = fused.slice(0, rerankTopN);
    const rr = await deps.rerankFn(query, pool, {
      topK,
      backend: opts.rerankBackend,
      model: opts.rerankModel,
    });
    return attachMeta(rr.results.slice(0, topK), {
      mode,
      topK,
      rerankTopN,
      rerankLatencyMs: rr.latencyMs,
      rerankBackend: rr.backend,
      rerankFallback: rr.fallback,
      ...(rr.fallbackReason ? { rerankFallbackReason: rr.fallbackReason } : {}),
    });
  }

  if (mode === "hybrid_rerank_meta" || mode === "adaptive") {
    const rerankTopN = Math.max(1, parseInt(opts.rerankTopN, 10) || DEFAULT_RERANK_TOP_N);
    const poolSize = Math.max(rerankTopN, topK * 2, 10);
    const [denseHits, bm25Hits] = await Promise.all([
      deps.denseFn(query, poolSize, where),
      deps.bm25Fn(query, poolSize, where),
    ]);
    const fused = reciprocalRankFusion(denseHits, bm25Hits, { k });
    const pool = fused.slice(0, rerankTopN);
    const rr = await deps.rerankFn(query, pool, {
      topK: rerankTopN,
      backend: opts.rerankBackend,
      model: opts.rerankModel,
    });
    const scored = scoreCandidates(query, rr.results, {
      weightMode: mode === "adaptive" ? "adaptive" : "fixed",
      weights: opts.weights,
      weightFn: opts.weightFn,
      docType: opts.docType,
      department: opts.department,
      entity: opts.entity,
      asOfDate: opts.asOfDate,
      version: opts.version,
      auth: opts.auth,
    });
    return attachMeta(scored.slice(0, topK), {
      mode,
      topK,
      rerankTopN,
      rerankLatencyMs: rr.latencyMs,
      rerankBackend: rr.backend,
      rerankFallback: rr.fallback,
      ...(rr.fallbackReason ? { rerankFallbackReason: rr.fallbackReason } : {}),
      weightSource: scored.scoringMeta.weightSource,
      weights: scored.scoringMeta.weights,
      filteredOut: scored.scoringMeta.filteredOut,
    });
  }

  if (mode === "hybrid") {
    const poolSize = Math.max(topK * 2, 10);
    const [denseHits, bm25Hits] = await Promise.all([
      deps.denseFn(query, poolSize, where),
      deps.bm25Fn(query, poolSize, where),
    ]);
    const fused = reciprocalRankFusion(denseHits, bm25Hits, { k });
    return attachMeta(fused.slice(0, topK), { mode, topK });
  }

  return attachMeta(await deps.denseFn(query, topK, where), { mode, topK });
}

function optionsK(opts) {
  const k = opts.k ?? opts.kRrf ?? DEFAULT_RRF_K;
  const n = Number(k);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RRF_K;
}

module.exports = {
  retrieve,
  getRetrievalMode,
  setRetrieverDeps,
  resetRetrieverDeps,
  VALID_MODES,
  DEFAULT_RRF_K,
  DEFAULT_RERANK_TOP_N,
  DEFAULT_RERANK_MODEL,
};
