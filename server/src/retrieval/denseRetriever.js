/**
 * Dense Retriever
 * Baseline vector-similarity retrieval using ChromaDB and Ollama embeddings.
 */

const { generateEmbedding } = require("../services/embeddingService");
const { search } = require("../services/chromaService");
const { normalizeMetadata } = require("../metadata/metadataSchema");

async function retrieveDense(query, topK = 5, where = null) {
  if (!query || typeof query !== "string") return [];
  const k = Math.max(1, parseInt(topK, 10) || 5);
  const embedding = await generateEmbedding(query);
  const results = await search(embedding, k, where);

  return results.map((r, rank) => {
    const dist = typeof r.distance === "number" ? r.distance : 1.0;
    // Cosine distance in Chroma: 0 (identical) to 2 (opposite).
    // Normalize to [0, 1] similarity: 1 - (dist / 2)
    const denseScore = Math.max(0, Math.min(1, 1 - dist / 2));
    return {
      id: r.id,
      text: r.text,
      metadata: normalizeMetadata(r.metadata),
      distance: r.distance,
      denseScore,
      denseRank: rank + 1,
    };
  });
}

module.exports = {
  retrieveDense,
};

