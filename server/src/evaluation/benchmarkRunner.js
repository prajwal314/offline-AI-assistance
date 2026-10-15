/**
 * Benchmark Runner
 * Runs quantitative benchmarks comparing RAG pipeline configurations.
 */

const fs = require("fs");
const path = require("path");
const { searchKnowledgeBase } = require("../services/retrievalService");
const { generateAnswer } = require("../services/llmService");
const {
  computeMRR,
  computePrecisionAtK,
  computeRecallAtK,
  computeNDCGAtK,
  aggregateMetrics,
} = require("./metrics");

function defaultDataset() {
  const p = path.join(__dirname, "../../../server/evaluation/dataset.json");
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  return [];
}

async function runBenchmarkForMode(mode = "dense", options = {}) {
  const dataset = options.dataset || defaultDataset();
  const topK = options.topK || 5;
  const threshold = options.threshold ?? null;
  const generate = options.generateAnswers ?? false;

  const queryResults = [];

  for (const item of dataset) {
    const t0 = Date.now();
    let retrieved = [];
    let error = null;

    try {
      const res = await searchKnowledgeBase(item.question, topK, { mode, threshold });
      retrieved = res.results || [];
    } catch (err) {
      error = err.message;
    }

    const latencyMs = Date.now() - t0;

    // Relevance evaluation function based on expectedSource or keyword match
    const isRelevantFn = (chunk) => {
      if (item.expectedSource === "none") return false;
      const typeMatch = (chunk.metadata?.sourceType || "") === item.expectedSource;
      return typeMatch;
    };

    const relevanceScoreFn = (chunk) => {
      if (item.expectedSource === "none") return 0;
      return isRelevantFn(chunk) ? 1 : 0;
    };

    let answer = "";
    let hallucinated = false;

    if (generate) {
      if (retrieved.length === 0) {
        answer = "I could not find enough relevant information in the knowledge base to answer this question.";
      } else {
        try {
          const genRes = await generateAnswer(item.question, retrieved);
          answer = genRes.answer || "";
        } catch (e) {
          answer = "ERROR: " + e.message;
        }
      }
      hallucinated = item.category === "unanswerable" && !answer.toLowerCase().includes("could not find");
    } else {
      // In retrieval-only mode, if chunks were retrieved for unanswerable question, count as potential hallucination risk
      hallucinated = item.category === "unanswerable" && retrieved.length > 0;
    }

    const mrr = computeMRR(retrieved, isRelevantFn);
    const precisionAtK = computePrecisionAtK(retrieved, isRelevantFn, topK);
    const recallAtK = computeRecallAtK(retrieved, isRelevantFn, 1, topK);
    const ndcgAtK = computeNDCGAtK(retrieved, relevanceScoreFn, topK);

    queryResults.push({
      id: item.id,
      category: item.category,
      question: item.question,
      expectedSource: item.expectedSource,
      retrievedCount: retrieved.length,
      latencyMs,
      mrr,
      precisionAtK,
      recallAtK,
      ndcgAtK,
      hallucinated,
      error,
      topEvidenceScore: retrieved[0]?.evidenceScore ?? null,
    });
  }

  const summary = aggregateMetrics(queryResults);

  return {
    mode,
    topK,
    threshold,
    summary,
    queryResults,
  };
}

async function runComparativeBenchmark(modes = ["dense", "hybrid", "hybrid_rerank", "hybrid_rerank_meta", "adaptive"], options = {}) {
  const comparison = {};
  for (const mode of modes) {
    comparison[mode] = await runBenchmarkForMode(mode, options);
  }
  return comparison;
}

module.exports = {
  runBenchmarkForMode,
  runComparativeBenchmark,
};

