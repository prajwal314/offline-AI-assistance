/**
 * Evaluation export (Change 5, step 6): CSV/JSON + markdown comparison table.
 * The markdown table is descriptive only — no winners declared.
 */

function fmt(v, digits = 3) {
  if (v === null || v === undefined) return "n/a";
  return Number(v).toFixed(digits);
}

const SUMMARY_COLUMNS = [
  ["method", "Method"],
  ["mode", "Pipeline"],
  ["n", "n"],
  ["avgPrecision", "P@K"],
  ["avgRecall", "R@K"],
  ["avgMRR", "MRR"],
  ["avgNDCG", "NDCG"],
  ["avgEvidenceCoverage", "Cover"],
  ["avgRedundancy", "Redun"],
  ["avgConflictCorrect", "Confl"],
  ["avgLatencyMs", "ms"],
  ["avgContextTokens", "tok"],
  ["avgCorrectness", "CorrJ"],
  ["avgTokenF1", "F1"],
  ["avgGroundedSupported", "Grnd+"],
  ["avgGroundedUnsupported", "Grnd-"],
  ["avgCitationSupport", "CitSup"],
  ["avgAgreement", "Agr"],
  ["avgStability", "Stab"],
  ["avgConflictDetected", "CofD"],
  ["avgConflictHandled", "CofH"],
  ["avgRetrievalMs", "RetMs"],
  ["avgSelectionMs", "SelMs"],
  ["avgGenerationMs", "GenMs"],
];

function comparisonMarkdown(comparison, meta = {}) {
  const methods = Object.keys(comparison).sort();
  const lines = [];
  if (meta.title) lines.push(`# ${meta.title}`, "");
  if (meta.datasetVersion || meta.split || meta.topK) {
    lines.push(`dataset=${meta.datasetVersion || "?"} split=${meta.split || "?"} topK=${meta.topK ?? "?"} questions=${meta.questionCount ?? "?"}. Averages; conflict column averaged over conflicting-evidence questions only.`, "");
  }
  lines.push(`| ${SUMMARY_COLUMNS.map(([, h]) => h).join(" | ")} |`);
  lines.push(`| ${SUMMARY_COLUMNS.map(() => "---").join(" | ")} |`);
  for (const m of methods) {
    const s = comparison[m];
    lines.push(`| ${SUMMARY_COLUMNS.map(([k]) => (k === "method" || k === "mode" || k === "n" ? String(s[k] ?? "?") : fmt(s[k]))).join(" | ")} |`);
  }
  return lines.join("\n");
}

const RESULT_COLUMNS = [
  "run_id", "method", "question_id", "query", "question_type", "split",
  "precision_at_k", "recall_at_k", "mrr", "ndcg", "evidence_coverage",
  "redundancy_rate", "conflict_correct", "latency_ms", "context_tokens",
  "selected_chunk_ids", "answer_faithfulness", "citation_accuracy", "error",
  "answer", "answer_correct_judge", "answer_correct_reason", "answer_token_f1",
  "grounded_supported_pct", "grounded_unsupported_pct", "citation_support_accuracy",
  "answer_agreement", "retrieval_stability", "conflict_detected", "conflict_handled",
  "retrieval_ms", "selection_ms", "generation_ms",
];

function csvCell(v) {
  if (v === null || v === undefined) return "";
  const s = Array.isArray(v) ? v.join(";") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function resultsToCsv(rows) {
  const lines = [RESULT_COLUMNS.join(",")];
  for (const r of rows) lines.push(RESULT_COLUMNS.map((c) => csvCell(r[c])).join(","));
  return lines.join("\n");
}

module.exports = {
  comparisonMarkdown,
  resultsToCsv,
  RESULT_COLUMNS,
};
