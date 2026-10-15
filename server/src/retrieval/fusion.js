/**
 * Reciprocal Rank Fusion (Change 1).
 * Merges dense and BM25 candidate lists. Each candidate keeps its original
 * per-method scores and ranks for later stages (rerank, scoring, evidence).
 */

const DEFAULT_RRF_K = 60;

function keyOf(c) {
  return String(c.chunkId ?? c.id);
}

function reciprocalRankFusion(denseList = [], bm25List = [], options = {}) {
  const k = options.k ?? options.kRrf ?? DEFAULT_RRF_K;
  const denseWeight = options.denseWeight ?? 1.0;
  const bm25Weight = options.bm25Weight ?? options.sparseWeight ?? 1.0;

  const map = new Map();

  denseList.forEach((item, idx) => {
    const rank = item.rank ?? item.denseRank ?? idx + 1;
    const score = item.score ?? item.denseScore ?? 0;
    map.set(keyOf(item), {
      chunkId: item.chunkId ?? item.id,
      id: item.chunkId ?? item.id,
      text: item.text,
      metadata: item.metadata || {},
      denseScore: score,
      denseRank: rank,
      bm25Score: 0,
      bm25Rank: null,
      // Back-compat aliases for callers on the old {sparseScore, sparseRank} shape.
      sparseScore: 0,
      sparseRank: null,
      rawBm25Score: null,
      rrfScore: denseWeight / (k + rank),
    });
  });

  bm25List.forEach((item, idx) => {
    const rank = item.rank ?? item.bm25Rank ?? item.sparseRank ?? idx + 1;
    const score = item.score ?? item.bm25Score ?? item.sparseScore ?? 0;
    const key = keyOf(item);
    const existing = map.get(key);
    if (existing) {
      existing.bm25Score = score;
      existing.bm25Rank = rank;
      existing.sparseScore = score;
      existing.sparseRank = rank;
      if (item.rawBm25Score != null) existing.rawBm25Score = item.rawBm25Score;
      existing.rrfScore += bm25Weight / (k + rank);
    } else {
      map.set(key, {
        chunkId: item.chunkId ?? item.id,
        id: item.chunkId ?? item.id,
        text: item.text,
        metadata: item.metadata || {},
        denseScore: 0,
        denseRank: null,
        bm25Score: score,
        bm25Rank: rank,
        sparseScore: score,
        sparseRank: rank,
        rawBm25Score: item.rawBm25Score ?? null,
        rrfScore: bm25Weight / (k + rank),
      });
    }
  });

  const merged = Array.from(map.values());
  merged.sort((a, b) => b.rrfScore - a.rrfScore);

  return merged.map((doc, idx) => ({
    ...doc,
    score: doc.rrfScore,
    rank: idx + 1,
  }));
}

module.exports = {
  reciprocalRankFusion,
  DEFAULT_RRF_K,
};
