const { generateEmbedding } = require("./embeddingService");
const { search } = require("./chromaService");

async function searchKnowledgeBase(query, topK = 5) {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Query is required");
  }
  const embedding = await generateEmbedding(query);
  const results = await search(embedding, topK);
  return results;
}

module.exports = { searchKnowledgeBase };
