/**
 * Dense retriever (Change 1).
 * Thin wrapper over the existing Chroma similarity search.
 * Returns canonical candidates: { chunkId, text, score, rank, metadata }.
 */

const { generateEmbedding } = require("../services/embeddingService");
const { search } = require("../services/chromaService");

function distanceToScore(dist) {
  const d = typeof dist === "number" ? dist : 1.0;
  // Chroma cosine distance: 0 (identical) .. 2 (opposite).
  return Math.max(0, Math.min(1, 1 - d / 2));
}

async function searchDense(query, topK = 5, where = null) {
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];
  const k = Math.max(1, parseInt(topK, 10) || 5);
  const embedding = await generateEmbedding(query);
  const results = await search(embedding, k, where);

  return results.map((r, i) => {
    const score = distanceToScore(r.distance);
    return {
      chunkId: r.id,
      // Alias for interop with legacy callers that expect `id`.
      id: r.id,
      text: r.text,
      score,
      rank: i + 1,
      metadata: r.metadata || {},
      // Preserved for later stages (fusion, rerank, thresholds).
      distance: r.distance ?? null,
      denseScore: score,
      denseRank: i + 1,
    };
  });
}

module.exports = {
  searchDense,
  distanceToScore,
};
