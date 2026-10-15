/**
 * Comparative RAG Architecture Benchmark CLI
 * Usage: node evaluation/benchmarkModes.js [topK] [generateAnswers=true|false]
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

const { runComparativeBenchmark } = require("../src/evaluation/benchmarkRunner");

async function main() {
  const args = process.argv.slice(2);
  const topK = parseInt(args[0], 10) || 5;
  const generateAnswers = args[1] === "true";

  console.log(`\n================================================================`);
  console.log(`  Adaptive Multi-Dimensional Evidence Scoring Evaluation`);
  console.log(`  Benchmarking 5 Architectures | Top-K = ${topK} | LLM Generation = ${generateAnswers}`);
  console.log(`================================================================\n`);

  const modes = ["dense", "hybrid", "hybrid_rerank", "hybrid_rerank_meta", "adaptive"];
  const tStart = Date.now();
  const benchmark = await runComparativeBenchmark(modes, { topK, generateAnswers });
  const totalElapsed = ((Date.now() - tStart) / 1000).toFixed(1);

  console.log(`\n-----------------------------------------------------------------------------------------`);
  console.log(`Architecture           | MRR     | Prec@${topK}  | Recall@${topK}| NDCG@${topK}  | Halluc. Rate | Latency (ms)`);
  console.log(`-----------------------------------------------------------------------------------------`);

  for (const mode of modes) {
    const s = benchmark[mode]?.summary || {};
    const name = mode.padEnd(22, " ");
    const mrr = (s.MRR?.toFixed(3) || "0.000").padStart(7, " ");
    const prec = (s.PrecisionAtK?.toFixed(3) || "0.000").padStart(8, " ");
    const rec = (s.RecallAtK?.toFixed(3) || "0.000").padStart(9, " ");
    const ndcg = (s.NDCGAtK?.toFixed(3) || "0.000").padStart(8, " ");
    const halluc = ((s.HallucinationRate * 100).toFixed(1) + "%").padStart(12, " ");
    const lat = (s.AvgLatencyMs?.toFixed(1) || "0").padStart(12, " ");
    console.log(`${name} | ${mrr} | ${prec} | ${rec} | ${ndcg} | ${halluc} | ${lat}`);
  }
  console.log(`-----------------------------------------------------------------------------------------\n`);
  console.log(`Total benchmark completed in ${totalElapsed}s`);

  const outPath = path.join(__dirname, `benchmark-modes-K${topK}-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(benchmark, null, 2));
  console.log(`Detailed report saved to: ${outPath}\n`);
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});

