/**
 * Retrieval Dispatcher
 * Dispatches queries to one of 5 configurable retrieval architectures:
 *  - 'dense'              (Baseline: Chroma vector search)
 *  - 'hybrid'             (Dense + BM25 with Reciprocal Rank Fusion)
 *  - 'hybrid_rerank'      (Hybrid + Cross-relevance reranker)
 *  - 'hybrid_rerank_meta' (Hybrid + Reranker + Multi-dimensional metadata scoring)
 *  - 'adaptive'           (Intent-adaptive weights, dynamic thresholds & diversity filtering)
 */

const { retrieveDense } = require("./denseRetriever");
const { retrieveHybrid } = require("./hybridRetriever");
const { rerankCandidates } = require("./reranker");
const { scoreMultiDimensional } = require("../scoring/multiDimensionalScorer");
const { scoreAdaptive } = require("../scoring/adaptiveScorer");
const { filterRedundantChunks } = require("../evidence/diversityFilter");
const { packEvidence } = require("../evidence/evidencePacker");

const VALID_MODES = ["dense", "hybrid", "hybrid_rerank", "hybrid_rerank_meta", "adaptive"];

function getRetrievalMode(overrideMode = null) {
  if (overrideMode && VALID_MODES.includes(overrideMode)) return overrideMode;
  const envMode = (process.env.RETRIEVAL_MODE || "dense").toLowerCase().trim();
  return VALID_MODES.includes(envMode) ? envMode : "dense";
}

async function dispatchRetrieval(query, topK = 5, opts = {}) {
  const mode = getRetrievalMode(opts.mode);
  const where = opts.where || null;
  const threshold = opts.threshold ?? null;
  const k = Math.max(1, parseInt(topK, 10) || 5);

  let results = [];
  let metaInfo = { mode, topK: k };

  switch (mode) {
    case "dense": {
      // Baseline behavior
      const dense = await retrieveDense(query, k, where);
      if (threshold != null) {
        results = dense.filter((r) => r.distance != null && r.distance <= threshold);
      } else {
        results = dense;
      }
      break;
    }

    case "hybrid": {
      const hybrid = await retrieveHybrid(query, k, where);
      if (threshold != null) {
        results = hybrid.filter((r) => r.distance == null || r.distance <= threshold);
      } else {
        results = hybrid;
      }
      break;
    }

    case "hybrid_rerank": {
      // Over-retrieve candidates for reranking
      const poolSize = Math.max(k * 2, 8);
      const candidates = await retrieveHybrid(query, poolSize, where);
      const reranked = await rerankCandidates(query, candidates, k);
      if (threshold != null) {
        results = reranked.filter((r) => r.distance == null || r.distance <= threshold);
      } else {
        results = reranked;
      }
      break;
    }

    case "hybrid_rerank_meta": {
      const poolSize = Math.max(k * 2, 8);
      const candidates = await retrieveHybrid(query, poolSize, where);
      const reranked = await rerankCandidates(query, candidates, poolSize);
      const scored = scoreMultiDimensional(query, reranked);
      const topMeta = scored.slice(0, k);
      if (threshold != null) {
        results = topMeta.filter((r) => r.distance == null || r.distance <= threshold);
      } else {
        results = topMeta;
      }
      break;
    }

    case "adaptive": {
      const poolSize = Math.max(k * 3, 10);
      const candidates = await retrieveHybrid(query, poolSize, where);
      const reranked = await rerankCandidates(query, candidates, poolSize);
      const adaptiveResult = scoreAdaptive(query, reranked);
      metaInfo.intent = adaptiveResult.intent;
      metaInfo.sufficiencyThreshold = adaptiveResult.sufficiencyThreshold;

      // Apply diversity filter to avoid redundant duplicate chunks
      const diverse = filterRedundantChunks(adaptiveResult.results);
      results = diverse.slice(0, k);
      break;
    }

    default: {
      results = await retrieveDense(query, k, where);
      break;
    }
  }

  const packed = packEvidence(results);
  return {
    results: packed,
    mode,
    topK: k,
    threshold,
    filteredCount: results.length < k ? k - results.length : 0,
    metaInfo,
  };
}

module.exports = {
  dispatchRetrieval,
  getRetrievalMode,
  VALID_MODES,
};

