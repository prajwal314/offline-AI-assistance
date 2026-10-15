/**
 * CLI: npm run ablate -- [--split validation] [--topK 5] [--poolSize 20] [--out evaluation/out]
 * Removes each feature/stage one at a time and reports metric deltas vs the
 * full pipeline. Defaults to the validation split to keep test pristine.
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
  const { runAblations } = require("../src/evaluation/ablate");

  const out = await runAblations({
    split: arg("split", "validation"),
    topK: Number(arg("topK", "5")),
    poolSize: Number(arg("poolSize", "20")),
  });
  const f = (v) => (v === null ? "n/a" : v.toFixed(3));
  console.log(`\nAblations on split "${arg("split", "validation")}" (n=${out.questionCount}). Baseline: cover=${f(out.baseline.coverage)} recall=${f(out.baseline.recall)} mrr=${f(out.baseline.mrr)} ndcg=${f(out.baseline.ndcg)}`);
  console.log("| Removed | ΔCover | ΔRecall | ΔMRR | ΔNDCG | ΔPrec |");
  console.log("| --- | --- | --- | --- | --- | --- |");
  for (const v of out.variants) {
    const d = (k) => (v.deltas[k] === null ? "n/a" : (v.deltas[k] > 0 ? "+" : "") + v.deltas[k].toFixed(3));
    console.log(`| ${v.removed} | ${d("coverage")} | ${d("recall")} | ${d("mrr")} | ${d("ndcg")} | ${d("precision")} |`);
  }

  const outDir = path.resolve(__dirname, "..", arg("out", "evaluation/out"));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.writeFileSync(path.join(outDir, `ablations-${stamp}.json`), JSON.stringify(out, null, 1));
  console.log(`Wrote ${outDir}/ablations-${stamp}.json`);
}

main().catch((err) => { console.error("ablate failed:", err.message); process.exit(1); });
