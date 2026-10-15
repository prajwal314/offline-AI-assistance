/**
 * CLI: npm run report -- [--methods A,B,C,D,E] [--split test] [--topK 5]
 *      [--datasetVersion v1] [--with-ablations] [--with-tuning] [--out evaluation/out]
 * Runs the methods, builds the final report (mean ± std, per-type breakdown,
 * honest deficits vs baseline A) and writes report.md. Optional sections run
 * tuning/ablations on the validation split so test stays a pure report split.
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
function flag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  require("dotenv").config();
  const { getDb } = require("../src/database/db");
  const { runEvaluation, METHOD_MODES } = require("../src/evaluation/runner");
  const { buildReport } = require("../src/evaluation/report");

  const methods = arg("methods", "A,B,C,D,E");
  const split = arg("split", "test");
  const topK = Number(arg("topK", "5"));
  const datasetVersion = arg("datasetVersion", "v1");

  console.log(`Evaluating methods [${methods}] on split "${split}"...`);
  const out = await runEvaluation({ methods, split, topK, datasetVersion, consistencyN: Number(arg("consistency", "0")) || 0 });
  const db = getDb();
  const questions = db.prepare("SELECT id, question_type FROM evaluation_questions WHERE split = ?").all(split);

  let ablations = null;
  if (flag("with-ablations")) {
    console.log("Running ablations on validation split...");
    const { runAblations } = require("../src/evaluation/ablate");
    ablations = await runAblations({ split: "validation", topK });
  }
  let tuning = null;
  if (flag("with-tuning")) {
    console.log("Tuning on validation split, reporting best on test...");
    const { tuneWeights, reportOnTest } = require("../src/evaluation/tune");
    const tuned = await tuneWeights({ split: "validation", topK });
    const testReport = await reportOnTest(tuned.best.config, { split, topK, objective: tuned.objective });
    tuning = { ...tuned, trials: tuned.trials.slice(0, 20), testReport };
  }

  const markdown = buildReport({
    resultsByMethod: out.results,
    questions,
    modes: METHOD_MODES,
    ablations,
    tuning,
    baseline: "A",
    meta: { split: out.split, topK: out.topK, datasetVersion: out.datasetVersion },
  });
  console.log("\n" + markdown + "\n");

  const outDir = path.resolve(__dirname, "..", arg("out", "evaluation/out"));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "report.md"), markdown + "\n");
  console.log("Wrote report.md");
}

main().catch((err) => { console.error("report failed:", err.message); process.exit(1); });
