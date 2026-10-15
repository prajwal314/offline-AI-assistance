const fs = require("fs");
const path = require("path");
const { searchKnowledgeBase } = require("../src/services/retrievalService");
const { generateAnswer } = require("../src/services/llmService");

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, "dataset.json"), "utf-8"));

function isCorrectSource(retrieved, expected) {
  if (expected === "none") return retrieved.length === 0;
  return retrieved.some((r) => (r.metadata?.sourceType || "") === expected);
}

async function run({ topK = 5, threshold = null, chunkConfig = "600/100" } = {}) {
  console.log(`\n=== RAG Evaluation topK=${topK} threshold=${threshold} chunk=${chunkConfig} ===`);
  const results = [];
  for (const q of dataset) {
    const start = Date.now();
    let retrieved = [];
    let insufficient = false;
    try {
      const res = await searchKnowledgeBase(q.question, topK, { threshold });
      retrieved = res.results;
      if (retrieved.length === 0) insufficient = true;
    } catch (e) { retrieved = []; insufficient = true; }
    let answer = "";
    if (!insufficient) {
      try { answer = await generateAnswer(q.question, retrieved); } catch (e) { answer = "ERROR: " + e.message; }
    } else {
      answer = "I could not find enough relevant information in the knowledge base to answer this question.";
    }
    const elapsed = Date.now() - start;
    const correctSource = isCorrectSource(retrieved, q.expectedSource);
    const hallucinated = q.category === "unanswerable" && !answer.includes("could not find");
    results.push({ id: q.id, category: q.category, question: q.question, expectedSource: q.expectedSource, retrievedCount: retrieved.length, correctSource, hallucinated, answer: answer.slice(0, 200), elapsed, distances: retrieved.slice(0, 3).map((r) => r.distance?.toFixed(3)) });
    console.log(`#${q.id} [${q.category}] K=${topK} dist=[${results[results.length - 1].distances}] srcOK=${correctSource} halluc=${hallucinated} ${elapsed}ms`);
  }
  const total = results.length;
  const srcAcc = results.filter((r) => r.correctSource).length / total;
  const top3 = results.filter((r) => r.retrievedCount > 0).length / total;
  const answerable = results.filter((r) => r.category === "answerable");
  const unanswerable = results.filter((r) => r.category === "unanswerable");
  const hallucRate = unanswerable.filter((r) => r.hallucinated).length / (unanswerable.length || 1);
  console.log(`\n--- Metrics ---`);
  console.log(`Retrieval accuracy (correct source in Top-K): ${(srcAcc * 100).toFixed(1)}% (${results.filter((r) => r.correctSource).length}/${total})`);
  console.log(`Answerable accuracy: ${(answerable.filter((r) => r.correctSource).length / (answerable.length || 1) * 100).toFixed(1)}%`);
  console.log(`Hallucination rate (unanswerable): ${(hallucRate * 100).toFixed(1)}% — lower is better`);
  console.log(`Avg latency: ${(results.reduce((a, b) => a + b.elapsed, 0) / total).toFixed(0)}ms`);
  const outPath = path.join(__dirname, `results-topK${topK}${threshold !== null ? "-thr" + threshold : ""}.json`);
  fs.writeFileSync(outPath, JSON.stringify({ config: { topK, threshold, chunkConfig }, metrics: { retrievalAccuracy: srcAcc, hallucinationRate: hallucRate }, results }, null, 2));
  console.log(`Saved ${outPath}`);
}

const args = process.argv.slice(2);
const topK = parseInt(args[0], 10) || 5;
const thr = args[1] ? parseFloat(args[1]) : null;
run({ topK, threshold: thr });
