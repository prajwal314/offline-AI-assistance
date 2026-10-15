/**
 * Scoring weights (Change 3).
 *
 * Step A — FIXED transparent default weights (the baseline). These live in
 * this config file so experiments can quote them exactly.
 *
 * Step B — query-dependent weights: a small rule-based function
 * (queries with IDs/codes raise the keyword weight, date/version mentions
 * raise the temporal weight). It is replaceable: call setWeightFunction(fn)
 * to plug in weights learned/tuned from validation data later.
 * No claim is made that adaptive weights are better — only experiments
 * will show that.
 */

const FEATURES = ["semantic", "keyword", "metadata", "temporal"];

// Step A: fixed baseline. Must sum to 1.
const DEFAULT_WEIGHTS = {
  semantic: 0.4,
  keyword: 0.3,
  metadata: 0.15,
  temporal: 0.15,
};

function round4(n) {
  return parseFloat(Number(n).toFixed(4));
}

/**
 * Clamp each weight to >= 0 and rescale so they sum to 1.
 * All-zero input falls back to an equal split (never NaN).
 */
function normalizeWeights(weights) {
  const clamped = {};
  for (const f of FEATURES) {
    const v = Number(weights?.[f]);
    clamped[f] = Number.isFinite(v) ? Math.max(0, v) : 0;
  }
  const sum = FEATURES.reduce((s, f) => s + clamped[f], 0);
  if (sum <= 0) {
    const equal = round4(1 / FEATURES.length);
    const out = {};
    for (const f of FEATURES) out[f] = equal;
    return out;
  }
  const out = {};
  for (const f of FEATURES) out[f] = round4(clamped[f] / sum);
  return out;
}

// ---------------------------------------------------------------------------
// Query signals (rule-based, Step B input)
// ---------------------------------------------------------------------------

const ID_OR_CODE_PATTERNS = [
  /\b\d{4,}\b/, // long numeric IDs (e.g. 26084285)
  /\b[A-Z]{2,}[._/-]*\d[\w.-]*\b/, // codes like CAT-2026, DOC_123
  /\bv(?:ersion)?\s*\d+(?:\.\d+)*/i, // version mentions
];

function hasIdOrCode(query) {
  const q = String(query || "");
  return ID_OR_CODE_PATTERNS.some((re) => re.test(q));
}

// ---------------------------------------------------------------------------
// Query-text parsing (single source; features.js re-exports these).
// Year matches inside an already-matched full date are skipped so one
// mention yields one signal.
// ---------------------------------------------------------------------------

function parseQueryDates(query) {
  const q = String(query || "");
  const out = [];
  const spans = [];
  const push = (raw, iso, index) => {
    if (!iso || Number.isNaN(Date.parse(iso))) return;
    if (!out.some((d) => d.iso === iso)) out.push({ raw, iso });
    if (index !== undefined) spans.push([index, index + raw.length]);
  };
  for (const m of q.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    push(m[0], `${m[1]}-${m[2]}-${m[3]}`, m.index);
  }
  for (const m of q.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g)) {
    push(m[0], `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`, m.index);
  }
  for (const m of q.matchAll(/\b((?:19|20)\d{2})\b/g)) {
    const idx = m.index ?? 0;
    if (spans.some(([s, e]) => idx >= s && idx < e)) continue;
    push(m[0], `${m[1]}-01-01`); // year-only: approximated to Jan 1
  }
  return out;
}

function parseQueryVersions(query) {
  const q = String(query || "");
  const out = [];
  for (const m of q.matchAll(/\bv(?:ersion)?\s*(\d+(?:\.\d+){0,2})\b/gi)) {
    const parts = m[1].split(".").map(Number);
    if (!out.some((v) => v.raw === m[0])) out.push({ raw: m[0], parts });
  }
  return out;
}

function hasDateOrVersionMention(query, opts = {}) {
  if (opts.asOfDate != null || opts.version != null) return true;
  if (opts.hasDateOrVersion === true) return true;
  if (opts.hasDateOrVersion === false) return false;
  return parseQueryDates(query).length > 0 || parseQueryVersions(query).length > 0;
}

function hasMetadataRequestMention(query, opts = {}) {
  void query;
  if (opts.hasMetadataRequest === true) return true;
  if (opts.hasMetadataRequest === false) return false;
  return opts.docType != null || opts.department != null || opts.entity != null;
}

// Step B: rule-based query-dependent weights. Starts from the fixed baseline,
// nudges the relevant feature, then renormalizes (so weights always sum to 1).
// Date/version/metadata mentions are detected in the query text itself unless
// the caller pins the flags via opts.
// Boost magnitudes are tunable via opts.ruleBoosts (see DEFAULT_RULE_BOOSTS);
// the tuner (evaluation/tune.js) searches these on the validation split only.
const DEFAULT_RULE_BOOSTS = { keyword: 0.15, temporal: 0.15, metadata: 0.1 };

function queryDependentWeights(query, opts = {}) {
  const boosts = { ...DEFAULT_RULE_BOOSTS, ...(opts.ruleBoosts || {}) };
  const w = { ...DEFAULT_WEIGHTS };
  const reasons = [];
  if (hasIdOrCode(query)) {
    w.keyword += boosts.keyword;
    reasons.push("keyword boosted for ID/code query");
  }
  if (hasDateOrVersionMention(query, opts)) {
    w.temporal += boosts.temporal;
    reasons.push("temporal boosted for date/version query");
  }
  if (hasMetadataRequestMention(query, opts)) {
    w.metadata += boosts.metadata;
    reasons.push("metadata boosted for document/entity request");
  }
  return { weights: normalizeWeights(w), reasons };
}

// Replaceable seam for later learned/tuned weights.
// fn(query, opts) -> weights object (need not sum to 1; normalized on use).
let customWeightFn = null;

function setWeightFunction(fn) {
  if (fn !== null && typeof fn !== "function") {
    throw new Error("weight function must be a function or null");
  }
  customWeightFn = fn;
}

function resetWeightFunction() {
  customWeightFn = null;
}

function getWeightFunction() {
  return customWeightFn;
}

/**
 * Resolve the weights for one query.
 * weightMode: "fixed" (Step A baseline) or "adaptive" (Step B rules or
 * a custom function installed via setWeightFunction / opts.weightFn).
 * opts.weights, if given, overrides everything (normalized on use).
 */
function resolveWeights(query, opts = {}) {
  const mode = opts.weightMode === "adaptive" ? "adaptive" : "fixed";
  if (opts.weights) {
    return { weights: normalizeWeights(opts.weights), source: "override", reasons: [] };
  }
  if (mode === "fixed") {
    return { weights: normalizeWeights(DEFAULT_WEIGHTS), source: "fixed", reasons: [] };
  }
  const fn = typeof opts.weightFn === "function" ? opts.weightFn : customWeightFn;
  if (fn) {
    return { weights: normalizeWeights(fn(query, opts)), source: "custom", reasons: [] };
  }
  const { weights, reasons } = queryDependentWeights(query, opts);
  return { weights, source: "adaptive", reasons };
}

module.exports = {
  FEATURES,
  DEFAULT_WEIGHTS,
  DEFAULT_RULE_BOOSTS,
  normalizeWeights,
  hasIdOrCode,
  parseQueryDates,
  parseQueryVersions,
  hasDateOrVersionMention,
  hasMetadataRequestMention,
  queryDependentWeights,
  setWeightFunction,
  resetWeightFunction,
  getWeightFunction,
  resolveWeights,
};
