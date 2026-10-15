/**
 * Statistical reporting helpers (Change 5 follow-up).
 * mean + population standard deviation (labelled as such), per-metric
 * detail objects, and per-question-type breakdowns.
 */

function numbers(vals) {
  return vals.filter((v) => typeof v === "number" && Number.isFinite(v));
}

function mean(vals) {
  const xs = numbers(vals);
  if (xs.length === 0) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

/** Population standard deviation (divides by n, not n-1). Null when empty. */
function std(vals) {
  const xs = numbers(vals);
  if (xs.length === 0) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) * (v - m), 0) / xs.length);
}

function round4(n) {
  return n === null ? null : parseFloat(Number(n).toFixed(4));
}

function describe(vals) {
  const xs = numbers(vals);
  return { n: xs.length, mean: round4(mean(xs)), std: round4(std(xs)) };
}

const DETAIL_METRICS = [
  ["precision_at_k", "precision"],
  ["recall_at_k", "recall"],
  ["mrr", "mrr"],
  ["ndcg", "ndcg"],
  ["evidence_coverage", "coverage"],
  ["redundancy_rate", "redundancy"],
  ["conflict_correct", "conflict"],
  ["latency_ms", "latencyMs"],
  ["context_tokens", "contextTokens"],
  ["answer_faithfulness", "faithfulness"],
  ["citation_accuracy", "citation"],
  ["answer_correct_judge", "correctness"],
  ["answer_token_f1", "tokenF1"],
  ["grounded_supported_pct", "groundedSupported"],
  ["grounded_unsupported_pct", "groundedUnsupported"],
  ["citation_support_accuracy", "citationSupport"],
  ["answer_agreement", "agreement"],
  ["retrieval_stability", "stability"],
  ["conflict_detected", "conflictDetected"],
  ["conflict_handled", "conflictHandled"],
  ["retrieval_ms", "retrievalMs"],
  ["selection_ms", "selectionMs"],
  ["generation_ms", "generationMs"],
];

/** Per-metric {n, mean, std} over a result list. */
function summarizeDetailed(results) {
  const out = {};
  for (const [field, name] of DETAIL_METRICS) {
    out[name] = describe(results.map((r) => r[field]));
  }
  return out;
}

/** Group results by question_type, then summarize each group. */
function breakdownByType(results) {
  const groups = {};
  for (const r of results) {
    const t = r.question_type || "unknown";
    (groups[t] = groups[t] || []).push(r);
  }
  const out = {};
  for (const [t, rows] of Object.entries(groups)) {
    out[t] = { n: rows.length, metrics: summarizeDetailed(rows) };
  }
  return out;
}

function fmtMeanStd(d, digits = 3) {
  if (!d || d.n === 0) return "n/a";
  return `${Number(d.mean).toFixed(digits)} ± ${Number(d.std).toFixed(digits)}`;
}

module.exports = {
  mean,
  std,
  describe,
  summarizeDetailed,
  breakdownByType,
  fmtMeanStd,
  DETAIL_METRICS,
};
