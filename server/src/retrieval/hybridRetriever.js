/**
 * Hybrid Retriever
 * Fuses Dense (semantic) and Sparse (lexical BM25) candidates using Reciprocal Rank Fusion (RRF).
 */

const { retrieveDense } = require("./denseRetriever");
const { retrieveSparse } = require("./sparseRetriever");

const DEFAULT_RRF_K = 60;

function computeRRF(denseList = [], sparseList = [], options = {}) {
  const kRrf = options.kRrf || DEFAULT_RRF_K;
  const denseWeight = options.denseWeight ?? 1.0;
  const sparseWeight = options.sparseWeight ?? 1.0;

  const docMap = new Map();

  // Process dense results
  denseList.forEach((item, idx) => {
    const rank = idx + 1;
    docMap.set(item.id, {
      ...item,
      denseRank: rank,
      denseScore: item.denseScore ?? 0,
      sparseRank: null,
      sparseScore: 0,
      rrfScore: denseWeight / (kRrf + rank),
    });
  });

  // Process sparse results
  sparseList.forEach((item, idx) => {
    const rank = idx + 1;
    const existing = docMap.get(item.id);
    if (existing) {
      existing.sparseRank = rank;
      existing.sparseScore = item.sparseScore ?? 0;
      existing.rawBm25Score = item.rawBm25Score;
      existing.rrfScore += sparseWeight / (kRrf + rank);
    } else {
      docMap.set(item.id, {
        ...item,
        denseRank: null,
        denseScore: 0,
        sparseRank: rank,
        sparseScore: item.sparseScore ?? 0,
        rrfScore: sparseWeight / (kRrf + rank),
      });
    }
  });

  const merged = Array.from(docMap.values());
  merged.sort((a, b) => b.rrfScore - a.rrfScore);

  // Normalize RRF scores to [0, 1] relative to theoretical max
  const maxPossibleRRF = (denseWeight / (kRrf + 1)) + (sparseWeight / (kRrf + 1));
  return merged.map((doc, idx) => ({
    ...doc,
    hybridRank: idx + 1,
    hybridScore: Math.min(1, Math.max(0, parseFloat((doc.rrfScore / maxPossibleRRF).toFixed(4)))),
  }));
}

async function retrieveHybrid(query, topK = 5, where = null, options = {}) {
  const candidatePoolSize = Math.max(topK * 2, 10);
  const [denseResults, sparseResults] = await Promise.all([
    retrieveDense(query, candidatePoolSize, where),
    retrieveSparse(query, candidatePoolSize, where),
  ]);

  const fused = computeRRF(denseResults, sparseResults, options);
  return fused.slice(0, topK);
}

module.exports = {
  retrieveHybrid,
  computeRRF,
  DEFAULT_RRF_K,
};

