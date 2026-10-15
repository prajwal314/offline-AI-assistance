/**
 * CLI: npm run evaluate -- --methods A,B,C,D,E --split test [--topK 5] [--datasetVersion v1] [--out evaluation/out]
 * Runs all methods on the same questions/corpus, prints a markdown comparison
 * table, and writes results JSON/CSV + comparison.md.
 */
const fs = require("fs");
const path = require("path");

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) return process.argv[i + 1];
  const pref = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (pref) return pref.slice(name.length + 3);
  return def;
}

async function main() {
  require("dotenv").config();
  const { runEvaluation } = require("../src/evaluation/runner");
  const { comparisonMarkdown, resultsToCsv } = require("../src/evaluation/export");

  const methods = arg("methods", "A,B,C,D,E");
  const split = arg("split", "test");
  const topK = Number(arg("topK", "5"));
  const datasetVersion = arg("datasetVersion", "v1");
  const outDir = path.resolve(__dirname, "..", arg("out", "evaluation/out"));
  const generateAnswers = process.argv.includes("--generate-answers");
  const consistencyN = Number(arg("consistency", "0")) || 0;

  console.log(`Evaluating methods [${methods}] on split "${split}" (topK=${topK})...`);
  const out = await runEvaluation({ methods, split, topK, datasetVersion, generateAnswers, consistencyN });
  const markdown = comparisonMarkdown(out.comparison, {
    title: "Retrieval experiment comparison",
    datasetVersion: out.datasetVersion,
    split: out.split,
    topK: out.topK,
    questionCount: out.questionCount,
  });
  console.log("\n" + markdown + "\n");

  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const flat = [];
  for (const m of Object.keys(out.results).sort()) {
    for (const r of out.results[m]) {
      const q = { method: m };
      flat.push({ ...q, ...r, selected_chunk_ids: r.selected_chunk_ids, conflicts: undefined, debug: undefined, answer: undefined });
    }
  }
  fs.writeFileSync(path.join(outDir, `results-${stamp}.json`), JSON.stringify({ ...out, markdown }, null, 1));
  fs.writeFileSync(path.join(outDir, `results-${stamp}.csv`), resultsToCsv(flat.map(({ answer, conflicts, debug, ...rest }) => rest)));
  fs.writeFileSync(path.join(outDir, "comparison.md"), markdown + "\n");
  console.log(`Wrote ${outDir} (results-${stamp}.json/csv, comparison.md)`);
}

main().catch((err) => { console.error("evaluate failed:", err.message); process.exit(1); });
