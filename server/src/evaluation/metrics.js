/**
 * Evaluation Metrics for RAG Research Benchmarks
 * Standard IR & RAG metrics: MRR, Precision@K, Recall@K, NDCG@K, Latency, and Hallucination Rate.
 */

function computeMRR(retrievedChunks = [], isRelevantFn) {
  for (let i = 0; i < retrievedChunks.length; i++) {
    if (isRelevantFn(retrievedChunks[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

function computePrecisionAtK(retrievedChunks = [], isRelevantFn, k = 5) {
  const topK = retrievedChunks.slice(0, k);
  if (topK.length === 0) return 0;
  const relevantCount = topK.filter(isRelevantFn).length;
  return relevantCount / topK.length;
}

function computeRecallAtK(retrievedChunks = [], isRelevantFn, totalKnownRelevant = 1, k = 5) {
  if (totalKnownRelevant <= 0) return 0;
  const topK = retrievedChunks.slice(0, k);
  const relevantCount = topK.filter(isRelevantFn).length;
  return Math.min(1, relevantCount / totalKnownRelevant);
}

function computeNDCGAtK(retrievedChunks = [], relevanceScoreFn, k = 5) {
  const topK = retrievedChunks.slice(0, k);
  if (topK.length === 0) return 0;

  // DCG
  let dcg = 0;
  const gains = [];
  topK.forEach((chunk, idx) => {
    const rel = relevanceScoreFn(chunk);
    gains.push(rel);
    dcg += (Math.pow(2, rel) - 1) / Math.log2(idx + 2);
  });

  // Ideal DCG
  const idealGains = [...gains].sort((a, b) => b - a);
  let idcg = 0;
  idealGains.forEach((rel, idx) => {
    idcg += (Math.pow(2, rel) - 1) / Math.log2(idx + 2);
  });

  return idcg > 0 ? dcg / idcg : 0;
}

function aggregateMetrics(results = []) {
  if (results.length === 0) return {};
  const total = results.length;

  const mrrSum = results.reduce((acc, r) => acc + (r.mrr || 0), 0);
  const precSum = results.reduce((acc, r) => acc + (r.precisionAtK || 0), 0);
  const recSum = results.reduce((acc, r) => acc + (r.recallAtK || 0), 0);
  const ndcgSum = results.reduce((acc, r) => acc + (r.ndcgAtK || 0), 0);
  const latencySum = results.reduce((acc, r) => acc + (r.latencyMs || 0), 0);

  const answerable = results.filter((r) => r.category !== "unanswerable");
  const unanswerable = results.filter((r) => r.category === "unanswerable");

  const unanswerableHallucinated = unanswerable.filter((r) => r.hallucinated).length;
  const hallucinationRate = unanswerable.length > 0 ? unanswerableHallucinated / unanswerable.length : 0;

  return {
    totalQueries: total,
    answerableQueries: answerable.length,
    unanswerableQueries: unanswerable.length,
    MRR: parseFloat((mrrSum / total).toFixed(4)),
    PrecisionAtK: parseFloat((precSum / total).toFixed(4)),
    RecallAtK: parseFloat((recSum / total).toFixed(4)),
    NDCGAtK: parseFloat((ndcgSum / total).toFixed(4)),
    HallucinationRate: parseFloat((hallucinationRate).toFixed(4)),
    AvgLatencyMs: parseFloat((latencySum / total).toFixed(1)),
  };
}

module.exports = {
  computeMRR,
  computePrecisionAtK,
  computeRecallAtK,
  computeNDCGAtK,
  aggregateMetrics,
};

