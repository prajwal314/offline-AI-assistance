/**
 * CLI: npm run tune -- --split validation [--trials 40] [--search random|grid]
 *      [--seed 42] [--objective composite|coverage|recall] [--topK 5]
 *      [--poolSize 20] [--test-split test] [--out evaluation/out]
 * Tunes on the validation split ONLY, then reports the winner on the test
 * split (read-only scoring, no tuning). Refuses --split test for tuning.
 */
const fs = require("fs");
const path = require("path");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !String(process.argv[i + 1]).startsWith("--")) return process.argv[i + 1];
  const pref = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (pref) return pref.slice(name.length + 3);
  return def;
}

async function main() {
  require("dotenv").config();
  const { tuneWeights, reportOnTest } = require("../src/evaluation/tune");

  const split = arg("split", "validation");
  const out = await tuneWeights({
    split,
    trials: Number(arg("trials", "40")),
    search: arg("search", "random"),
    seed: Number(arg("seed", "42")),
    objective: arg("objective", "composite"),
    topK: Number(arg("topK", "5")),
    poolSize: Number(arg("poolSize", "20")),
  });
  console.log(`\nTuned on split "${out.split}" (n=${out.questionCount}, objective=${out.objective}). Test split untouched.`);
  console.log("Top 5 trials (validation):");
  for (const t of out.trials.slice(0, 5)) {
    console.log(`  obj=${t.objective.toFixed(4)} ${t.label}`);
  }
  console.log(`\nBest: ${out.best.label} (validation obj=${out.best.objective.toFixed(4)})`);

  const testSplit = arg("test-split", "test");
  const test = await reportOnTest(out.best.config, {
    split: testSplit,
    topK: Number(arg("topK", "5")),
    poolSize: Number(arg("poolSize", "20")),
    objective: out.objective,
  });
  const m = test.metrics;
  console.log(`Test report (${testSplit}, n=${test.questionCount}): obj=${test.objective.toFixed(4)} cover=${m.coverage.toFixed(3)} recall=${m.recall.toFixed(3)} mrr=${m.mrr.toFixed(3)} ndcg=${m.ndcg.toFixed(3)}`);

  const outDir = path.resolve(__dirname, "..", arg("out", "evaluation/out"));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(outDir, `tuning-${stamp}.json`), JSON.stringify({ tuning: { ...out, trials: out.trials.slice(0, 20) }, testReport: test }, null, 1));
  console.log(`Wrote ${outDir}/tuning-${stamp}.json`);
}

main().catch((err) => { console.error("tune failed:", err.message); process.exit(1); });
