/**
 * Final report generator: A–E tables with mean ± std (population std),
 * per-question-type breakdowns, ablation deltas, tuning summary, and an
 * explicit honest-notes section listing every case where a proposed method
 * does NOT beat the baseline. Descriptive only — no winners declared.
 */

const { summarizeDetailed, breakdownByType, fmtMeanStd } = require("./stats");

const CORE_METRICS = ["precision", "recall", "mrr", "ndcg", "coverage", "redundancy", "conflict"];
const CORE_LABELS = { precision: "P@K", recall: "R@K", mrr: "MRR", ndcg: "NDCG", coverage: "Cover", redundancy: "Redun", conflict: "Confl" };

// Higher-is-better answer/robustness metrics for the quality table + notes.
const QUALITY_METRICS = ["correctness", "tokenF1", "groundedSupported", "citationSupport", "agreement", "stability", "conflictHandled"];
const QUALITY_LABELS = { correctness: "CorrJ", tokenF1: "F1", groundedSupported: "Grnd+", citationSupport: "CitSup", agreement: "Agr", stability: "Stab", conflictHandled: "CofH" };

function withTypes(resultsByMethod, questions) {
  const byId = new Map((questions || []).map((q) => [q.id, q.question_type || "unknown"]));
  const out = {};
  for (const [m, rows] of Object.entries(resultsByMethod || {})) {
    out[m] = rows.map((r) => ({ ...r, question_type: r.question_type || byId.get(r.question_id) || "unknown" }));
  }
  return out;
}

/** Cases where method fails to beat baseline (strictly lower mean). */
function notBeatingNotes(typed, baseline = "A") {
  const notes = [];
  const base = typed[baseline];
  if (!base) return [`baseline ${baseline} not present in results`];
  const baseDetail = summarizeDetailed(base);
  const higherBetter = [...CORE_METRICS.filter((m) => m !== "redundancy"), ...QUALITY_METRICS];
  const labels = { ...CORE_LABELS, ...QUALITY_LABELS };
  for (const m of Object.keys(typed).sort()) {
    if (m === baseline) continue;
    const d = summarizeDetailed(typed[m]);
    for (const metric of higherBetter) {
      const b = baseDetail[metric];
      const v = d[metric];
      if (!b || b.n === 0 || !v || v.n === 0) continue;
      if (v.mean < b.mean) {
        notes.push(`${m} does NOT beat ${baseline} on ${labels[metric]} (${v.mean.toFixed(3)} vs ${baseline} ${b.mean.toFixed(3)}, n=${v.n})`);
      }
    }
    const br = baseDetail.redundancy;
    const vr = d.redundancy;
    if (br && vr && vr.n > 0 && vr.mean > br.mean) {
      notes.push(`${m} has HIGHER redundancy than ${baseline} (${vr.mean.toFixed(3)} vs ${br.mean.toFixed(3)})`);
    }
    const bg = baseDetail.groundedUnsupported;
    const vg = d.groundedUnsupported;
    if (bg && vg && vg.n > 0 && vg.mean > bg.mean) {
      notes.push(`${m} has HIGHER unsupported-claim rate than ${baseline} (${vg.mean.toFixed(3)} vs ${bg.mean.toFixed(3)})`);
    }
  }
  return notes;
}

function methodTable(typed, meta) {
  const methods = Object.keys(typed).sort();
  const lines = [];
  lines.push(`| Method | Pipeline | ${CORE_METRICS.map((m) => CORE_LABELS[m]).join(" | ")} | n |`);
  lines.push(`| --- | --- | ${CORE_METRICS.map(() => "---").join(" | ")} | --- |`);
  for (const m of methods) {
    const d = summarizeDetailed(typed[m]);
    const mode = (meta.modes && meta.modes[m]) || "?";
    lines.push(`| ${m} | ${mode} | ${CORE_METRICS.map((k) => fmtMeanStd(d[k])).join(" | ")} | ${typed[m].length} |`);
  }
  return lines.join("\n");
}

function latencyTable(typed) {
  const lines = [];
  lines.push(`| Method | Retrieval ms | Selection ms | Generation ms | Total ms |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const m of Object.keys(typed).sort()) {
    const d = summarizeDetailed(typed[m]);
    const cell = (k) => (d[k] && d[k].n > 0 ? fmtMeanStd(d[k], 1) : "n/a");
    lines.push(`| ${m} | ${cell("retrievalMs")} | ${cell("selectionMs")} | ${cell("generationMs")} | ${cell("latencyMs")} |`);
  }
  lines.push("", "Stage boundary note: for method E the assembler call (retrieval loop + selection) is timed inside retrieval_ms; selection_ms then covers only final shaping. Reported as measured, not reallocated.");
  return lines.join("\n");
}

function qualityTable(typed) {
  const lines = [];
  lines.push(`| Method | ${QUALITY_METRICS.map((m) => QUALITY_LABELS[m]).join(" | ")} | Grnd- | n |`);
  lines.push(`| --- | ${QUALITY_METRICS.map(() => "---").join(" | ")} | --- | --- |`);
  for (const m of Object.keys(typed).sort()) {
    const d = summarizeDetailed(typed[m]);
    lines.push(`| ${m} | ${QUALITY_METRICS.map((k) => fmtMeanStd(d[k])).join(" | ")} | ${fmtMeanStd(d.groundedUnsupported)} | ${typed[m].length} |`);
  }
  lines.push("", "CorrJ = Ollama-judge correctness (approximation). Grnd+/Grnd- = supported/unsupported claim fractions. CitSup = cited-chunk support accuracy. Nulls (n/a) mean no answer was generated or no judge ran — generate with answers to populate this table.");
  return lines.join("\n");
}
function typeBreakdownTable(typed) {
  const lines = [];
  for (const m of Object.keys(typed).sort()) {
    lines.push(`\n#### Method ${m}`, "");
    lines.push(`| Type | n | P@K | R@K | MRR | NDCG | Cover |`);
    lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
    const bd = breakdownByType(typed[m]);
    for (const t of Object.keys(bd).sort()) {
      const d = bd[t].metrics;
      lines.push(`| ${t} | ${bd[t].n} | ${fmtMeanStd(d.precision)} | ${fmtMeanStd(d.recall)} | ${fmtMeanStd(d.mrr)} | ${fmtMeanStd(d.ndcg)} | ${fmtMeanStd(d.coverage)} |`);
    }
  }
  return lines.join("\n");
}

function ablationTable(ablations) {
  if (!ablations) return "n/a (ablations not run)";
  const lines = [];
  lines.push(`baseline coverage=${fmt(ablations.baseline.coverage)} recall=${fmt(ablations.baseline.recall)} mrr=${fmt(ablations.baseline.mrr)} ndcg=${fmt(ablations.baseline.ndcg)} (n=${ablations.questionCount})`, "");
  lines.push(`| Removed | ΔCover | ΔRecall | ΔMRR | ΔNDCG | ΔPrec |`);
  lines.push(`| --- | --- | --- | --- | --- | --- |`);
  for (const v of ablations.variants) {
    const d = (k) => (v.deltas[k] === null ? "n/a" : (v.deltas[k] > 0 ? "+" : "") + v.deltas[k].toFixed(3));
    lines.push(`| ${v.removed} | ${d("coverage")} | ${d("recall")} | ${d("mrr")} | ${d("ndcg")} | ${d("precision")} |`);
  }
  return lines.join("\n");
}

function fmt(v) {
  return v === null || v === undefined ? "n/a" : Number(v).toFixed(3);
}

function tuningSection(tuning) {
  if (!tuning) return "n/a (tuning not run)";
  const lines = [];
  lines.push(`Tuned on **${tuning.split}** split only (objective: ${tuning.objective}, ${tuning.best ? "winner reported below" : "no trials"}). Test split was not touched during search.`, "");
  if (tuning.best) {
    lines.push(`- Validation best: \`${tuning.best.label}\` objective=${tuning.best.objective.toFixed(4)}`);
    lines.push(`- Validation metrics: cover=${fmt(tuning.best.metrics.coverage)} recall=${fmt(tuning.best.metrics.recall)} mrr=${fmt(tuning.best.metrics.mrr)} ndcg=${fmt(tuning.best.metrics.ndcg)}`);
  }
  if (tuning.testReport) {
    lines.push(`- Test report (same config, unseen split): objective=${tuning.testReport.objective.toFixed(4)} cover=${fmt(tuning.testReport.metrics.coverage)} recall=${fmt(tuning.testReport.metrics.recall)} mrr=${fmt(tuning.testReport.metrics.mrr)} ndcg=${fmt(tuning.testReport.metrics.ndcg)}`);
  }
  if (tuning.trials && tuning.trials.length > 1) {
    lines.push("", "Top trials (validation):");
    for (const t of tuning.trials.slice(0, 5)) {
      lines.push(`- \`${t.label}\` objective=${t.objective.toFixed(4)}`);
    }
  }
  return lines.join("\n");
}

/**
 * buildReport({ resultsByMethod, questions, modes, ablations, tuning,
 *               baseline='A', meta }) -> markdown string.
 */
function buildReport(opts = {}) {
  const baseline = opts.baseline || "A";
  const typed = withTypes(opts.resultsByMethod, opts.questions);
  const notes = notBeatingNotes(typed, baseline);
  const lines = [];
  lines.push(`# Retrieval experiment report`, "");
  if (opts.meta) {
    lines.push(`split=${opts.meta.split || "?"} topK=${opts.meta.topK ?? "?"} dataset=${opts.meta.datasetVersion || "?"} baseline=${baseline} (dense). Means with population std; conflict averaged over conflicting-evidence questions only.`, "");
  }
  lines.push(`## A–E comparison (all metrics)`, "", methodTable(typed, { modes: opts.modes }), "");
  lines.push(`## Answer quality & robustness (judge-based cells are approximations)`, "", qualityTable(typed), "");
  lines.push(`## Latency breakdown per stage (mean ± std, ms)`, "", latencyTable(typed), "");
  lines.push(`## Per-question-type breakdown`, typeBreakdownTable(typed), "");
  lines.push(`## Ablations (metric change vs full pipeline)`, "", ablationTable(opts.ablations), "");
  lines.push(`## Weight tuning`, "", tuningSection(opts.tuning), "");
  lines.push(`## Honest notes (where proposed methods do NOT beat the baseline)`, "");
  if (notes.length === 0) {
    lines.push(`No deficits found: every non-baseline method matched or beat ${baseline} on every core metric in this run. Treat small gaps as noise — see std above.`);
  } else {
    for (const n of notes) lines.push(`- ${n}`);
    lines.push("", "Small gaps may be noise (check ± std and n). Only experiments on the real labeled set decide.");
  }
  return lines.join("\n");
}

module.exports = { buildReport, notBeatingNotes, withTypes, CORE_METRICS, QUALITY_METRICS, qualityTable, latencyTable };
