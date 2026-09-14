const { generateEmbedding } = require("./embeddingService");
const { search } = require("./chromaService");

const DEFAULT_TOP_K = 5;
const ALLOWED_TOP_K = [3, 5, 8, 10];
const MIN_TOP_K = 1;
const MAX_TOP_K = 20;
const DEFAULT_THRESHOLD = null;

function normalizeTopK(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return DEFAULT_TOP_K;
  if (n < MIN_TOP_K) return MIN_TOP_K;
  if (n > MAX_TOP_K) return MAX_TOP_K;
  return n;
}

function normalizeThreshold(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_THRESHOLD;
  const n = parseFloat(value);
  if (Number.isNaN(n)) return DEFAULT_THRESHOLD;
  if (n < 0) return 0;
  if (n > 2) return 2;
  return n;
}

function buildWhere(filter) {
  if (!filter || typeof filter !== "object") return null;
  const where = {};
  if (filter.sourceType === "document" || filter.sourceType === "web") where.sourceType = filter.sourceType;
  if (filter.documentId) where.documentId = String(filter.documentId);
  if (filter.topic) where.topic = String(filter.topic);
  return Object.keys(where).length > 0 ? where : null;
}

async function searchKnowledgeBase(query, topK = DEFAULT_TOP_K, opts = {}) {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Query is required");
  }
  const k = normalizeTopK(topK);
  const threshold = normalizeThreshold(opts.threshold);
  const where = buildWhere(opts.filter || opts.where);
  const embedding = await generateEmbedding(query);
  const results = await search(embedding, k, where);
  if (threshold !== null && threshold !== undefined) {
    const filtered = results.filter((r) => r.distance !== null && r.distance <= threshold);
    return { results: filtered, threshold, filteredCount: results.length - filtered.length, where, topK: k };
  }
  return { results, threshold: null, filteredCount: 0, where, topK: k };
}

module.exports = { searchKnowledgeBase, DEFAULT_TOP_K, ALLOWED_TOP_K, DEFAULT_THRESHOLD, normalizeTopK, normalizeThreshold, buildWhere };
