// Version 2 evaluation — SAME benchmark as V1 (dataset.json + scoring rules
// unchanged), routed through the Confidence-Aware RAG flow so V1 and V2 can be
// compared directly. Records the V1 outcomes plus V2-specific metrics:
// retry frequency, retry recovery rate, abstention accuracy, latency
// (mean/median), technical failure rate. Usage:
//   node evaluation/runEvaluationV2.js [topK] [threshold]
const fs = require("fs");
const path = require("path");
const { runConfidenceAwareRetrieval } = require("../src/services/confidenceRagService");
const { generateAnswer } = require("../src/services/llmService");

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "dataset.json"), "utf-8"));

function isCorrectSource(retrieved, expected) {
  if (expected === "none") return retrieved.length === 0;
  return retrieved.some((r) => (r.metadata?.sourceType || "") === expected);
}

async function run({ topK = 5, threshold = null, chunkConfig = "600/100" } = {}) {
  console.log(`\n=== RAG V2 Evaluation topK=${topK} threshold=${threshold} chunk=${chunkConfig} ===`);
  const results = [];
  for (const q of dataset) {
    const start = Date.now();
    let trace = null;
    let technicalError = null;
    try {
      trace = await runConfidenceAwareRetrieval(q.question, { topK, threshold });
    } catch (e) {
      technicalError = String(e.message).slice(0, 200);
    }
    let answer = "";
    let retrieved = [];
    if (technicalError) {
      answer = "ERROR: " + technicalError;
    } else {
      retrieved = trace.chunks;
      if (trace.decision === "abstain") {
        answer = "I could not find enough relevant information in the knowledge base to answer this question.";
      } else {
        try {
          const gen = await generateAnswer(q.question, retrieved);
          answer = typeof gen === "string" ? gen : gen.answer;
        } catch (e) {
          technicalError = String(e.message).slice(0, 200);
          answer = "ERROR: " + technicalError;
        }
      }
    }
    const elapsed = Date.now() - start;
    const correctSource = technicalError ? false : isCorrectSource(retrieved, q.expectedSource);
    const hallucinated = !technicalError && q.category === "unanswerable" && !answer.includes("could not find");
    const abstained = !technicalError && trace && trace.decision === "abstain";
    results.push({
      id: q.id, category: q.category, question: q.question, expectedSource: q.expectedSource,
      retrievedCount: retrieved.length, correctSource, hallucinated,
      decision: technicalError ? "error" : trace.decision,
      abstained, retryOccurred: trace ? trace.retryOccurred : false,
      recovered: trace ? trace.recovered : false,
      refinedQuery: trace ? trace.refinedQuery : null,
      initialCount: trace ? trace.initialCount : null,
      evidenceMethod: trace && trace.finalEvidence ? trace.finalEvidence.method : null,
      evidenceReason: trace && trace.finalEvidence ? trace.finalEvidence.reason : null,
      answer: answer.slice(0, 200), elapsed,
      ragLatencyMs: trace ? trace.latencyMs : null,
      technicalError,
      distances: retrieved.slice(0, 3).map((r) => (r.distance !== null && r.distance !== undefined ? Number(r.distance).toFixed(3) : null)),
    });
    console.log(`#${q.id} [${q.category}] decision=${results[results.length - 1].decision} retry=${trace ? trace.retryOccurred : "-"} rec=${trace ? trace.recovered : "-"} srcOK=${correctSource} halluc=${hallucinated} ${elapsed}ms`);
  }
  const total = results.length;
  const ok = results.filter((r) => !r.technicalError);
  const srcAcc = results.filter((r) => r.correctSource).length / total;
  const answerable = results.filter((r) => r.category === "answerable");
  const unanswerable = results.filter((r) => r.category === "unanswerable");
  const hallucRate = unanswerable.filter((r) => r.hallucinated).length / (unanswerable.length || 1);
  const abstentionAcc = unanswerable.filter((r) => r.abstained).length / (unanswerable.length || 1);
  const retries = results.filter((r) => r.retryOccurred).length;
  const recovered = results.filter((r) => r.recovered).length;
  const lat = results.map((r) => r.elapsed).sort((a, b) => a - b);
  const mean = lat.reduce((a, b) => a + b, 0) / (lat.length || 1);
  const median = lat.length ? lat[Math.floor(lat.length / 2)] : 0;
  const techFail = results.filter((r) => r.technicalError).length / total;
  console.log(`\n--- V2 Metrics (same scoring as V1, plus V2 extras) ---`);
  console.log(`Retrieval accuracy (correct source in Top-K): ${(srcAcc * 100).toFixed(1)}%`);
  console.log(`Answerable accuracy: ${(answerable.filter((r) => r.correctSource).length / (answerable.length || 1) * 100).toFixed(1)}%`);
  console.log(`Hallucination rate (unanswerable): ${(hallucRate * 100).toFixed(1)}% — lower is better`);
  console.log(`Abstention accuracy (unanswerable→abstain): ${(abstentionAcc * 100).toFixed(1)}% — higher is better`);
  console.log(`Retry frequency: ${(retries / total * 100).toFixed(1)}% (${retries}/${total})`);
  console.log(`Retry recovery rate: ${retries ? (recovered / retries * 100).toFixed(1) : "n/a"}% (${recovered}/${retries} recovered)`);
  console.log(`Latency: mean ${mean.toFixed(0)}ms, median ${median.toFixed(0)}ms`);
  console.log(`Technical failure rate: ${(techFail * 100).toFixed(1)}%`);
  console.log(`Evaluated: ${ok.length}/${total} without technical errors`);
  const outPath = path.join(__dirname, `results-v2-topK${topK}${threshold !== null ? "-thr" + threshold : ""}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    config: { version: 2, topK, threshold, chunkConfig },
    metrics: {
      retrievalAccuracy: srcAcc, hallucinationRate: hallucRate, abstentionAccuracy: abstentionAcc,
      retryFrequency: retries / total, retryRecoveryRate: retries ? recovered / retries : null,
      meanLatencyMs: mean, medianLatencyMs: median, technicalFailureRate: techFail,
    },
    results,
  }, null, 2));
  console.log(`Saved ${outPath}`);
}

const args = process.argv.slice(2);
const topK = parseInt(args[0], 10) || 5;
const thr = args[1] ? parseFloat(args[1]) : null;
run({ topK, threshold: thr });
