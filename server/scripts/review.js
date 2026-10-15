/**
 * CLI: npm run review -- [--runId 3] [--n 20] [--seed 7] [--format markdown|json] [--out evaluation/out]
 * Exports a deterministic manual-review sample (answers, cited chunks, judge
 * verdicts) for hand-verifying judge accuracy.
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
  const { sampleReview, reviewMarkdown } = require("../src/evaluation/review");

  const sample = await sampleReview({
    runId: arg("runId", undefined) !== undefined ? Number(arg("runId")) : undefined,
    n: Number(arg("n", "20")),
    seed: Number(arg("seed", "7")),
  });
  const format = String(arg("format", "markdown")).toLowerCase();
  const outDir = path.resolve(__dirname, "..", arg("out", "evaluation/out"));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (format === "json") {
    fs.writeFileSync(path.join(outDir, `review-${stamp}.json`), JSON.stringify(sample, null, 1));
    console.log(`Sampled ${sample.sampled.length} question(s) from run ${sample.run_id}. Wrote ${outDir}/review-${stamp}.json`);
  } else {
    fs.writeFileSync(path.join(outDir, `review-${stamp}.md`), reviewMarkdown(sample));
    console.log(`Sampled ${sample.sampled.length} question(s) from run ${sample.run_id}. Wrote ${outDir}/review-${stamp}.md`);
  }
}

main().catch((err) => { console.error("review failed:", err.message); process.exit(1); });
