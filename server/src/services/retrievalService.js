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
  const conditions = [];
  if (filter.sourceType === "document" || filter.sourceType === "web") {
    conditions.push({ sourceType: { $eq: filter.sourceType } });
  }
  if (filter.documentId) conditions.push({ documentId: { $eq: String(filter.documentId) } });
  if (filter.topic) conditions.push({ topic: { $eq: String(filter.topic) } });
  if (conditions.length === 0) return null;
  return conditions.length === 1 ? conditions[0] : { $and: conditions };
}

const { dispatchRetrieval, getRetrievalMode, VALID_MODES } = require("../retrieval/retrievalDispatcher");

async function searchKnowledgeBase(query, topK = DEFAULT_TOP_K, opts = {}) {
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    throw new Error("Query is required");
  }
  const k = normalizeTopK(topK);
  const threshold = normalizeThreshold(opts.threshold);
  const where = buildWhere(opts.filter || opts.where);

  const dispatchRes = await dispatchRetrieval(query, k, {
    ...opts,
    where,
    threshold,
  });

  return {
    results: dispatchRes.results,
    threshold,
    filteredCount: dispatchRes.filteredCount,
    where,
    topK: k,
    mode: dispatchRes.mode,
    metaInfo: dispatchRes.metaInfo,
  };
}

module.exports = {
  searchKnowledgeBase,
  DEFAULT_TOP_K,
  ALLOWED_TOP_K,
  DEFAULT_THRESHOLD,
  normalizeTopK,
  normalizeThreshold,
  buildWhere,
  getRetrievalMode,
  VALID_MODES,
};

