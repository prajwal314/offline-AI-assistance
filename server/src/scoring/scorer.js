/**
 * Evidence scorer (Change 3): S(c|q) = sum_i w_i(q) * f_i(q,c).
 *
 * Pipeline per call (order matters):
 *   1. HARD FILTER — authorization-style exclusions (opts.auth) are applied
 *      BEFORE scoring and are never a score feature. There is no auth model
 *      in the app today; this is the seam any future one must use.
 *   2. Feature extraction (see ./features): semantic/keyword/metadata/temporal.
 *   3. Weight resolution (see ./weights): "fixed" baseline or "adaptive"
 *      query-dependent (or a caller-supplied / installed custom function).
 *   4. Weighted sum, clamped to [0, 1], with per-feature breakdown and a
 *      human-readable explanation on every candidate.
 */

const { FEATURES, resolveWeights } = require("./weights");
const { extractFeatures, detectSignals } = require("./features");

function round4(n) {
  return parseFloat(Number(n).toFixed(4));
}

function candidateDocId(c) {
  return c?.metadata?.documentId ?? c?.documentId ?? null;
}

// ---------------------------------------------------------------------------
// 1. Hard filter (authorization-style). Pre-scoring, never a feature.
// ---------------------------------------------------------------------------

/**
 * auth shape (all optional; absent auth passes everything through):
 *   { allowedDocumentIds: [...], allowedSourceTypes: [...], predicate: (c) => bool }
 * Returns { kept, removed } — removed items never reach scoring.
 */
function applyHardFilters(candidates, auth) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!auth || typeof auth !== "object") return { kept: list, removed: [] };
  const ids = auth.allowedDocumentIds ? new Set(auth.allowedDocumentIds.map(String)) : null;
  const types = auth.allowedSourceTypes ? new Set(auth.allowedSourceTypes) : null;
  const pred = typeof auth.predicate === "function" ? auth.predicate : null;
  if (!ids && !types && !pred) return { kept: list, removed: [] };

  const kept = [];
  const removed = [];
  for (const c of list) {
    let ok = true;
    if (ids) {
      const id = candidateDocId(c);
      ok = ok && id !== null && ids.has(String(id));
    }
    if (ok && types) ok = types.has(c?.metadata?.sourceType);
    if (ok && pred) ok = pred(c) === true;
    (ok ? kept : removed).push(c);
  }
  return { kept, removed };
}

// ---------------------------------------------------------------------------
// 4. Explanation
// ---------------------------------------------------------------------------

function buildExplanation({ score, weights, weightSource, weightReasons, features, query, details }) {
  const terms = FEATURES.map((f) => `${weights[f].toFixed(2)}·${f}(${features[f].toFixed(2)})`).join(" + ");
  let text = `${score.toFixed(2)} = ${terms} [weights: ${weightSource}`;
  if (weightReasons && weightReasons.length > 0) text += ` — ${weightReasons.join("; ")}`;
  text += "]";

  const notes = [];
  const t = details?.temporal;
  if (t && typeof t === "object" && t.status && t.status !== "active") {
    notes.push(`chunk status is ${t.status}`);
  }
  if (t && typeof t === "object" && t.requestedDate && t.effectiveDate && t.effectiveDate > t.requestedDate) {
    notes.push(`effective ${t.effectiveDate} is after requested ${t.requestedDate}`);
  }
  if (t && typeof t === "object" && t.requestedVersion && t.chunkVersion && t.requestedVersion !== t.chunkVersion) {
    notes.push(`chunk version ${t.chunkVersion} vs requested ${t.requestedVersion}`);
  }
  const m = details?.metadata;
  if (Array.isArray(m)) {
    for (const p of m) {
      if (p.value === 1) notes.push(`${p.facet} matches "${p.want}"`);
      else if (p.value === 0) notes.push(`${p.facet} mismatches "${p.want}"`);
    }
  }
  if (notes.length > 0) text += `; note: ${notes.join("; ")}`;
  void query;
  return text;
}

// ---------------------------------------------------------------------------
// Full scoring pass
// ---------------------------------------------------------------------------

/**
 * scoreCandidates(query, candidates, opts)
 * opts: { weightMode: "fixed"|"adaptive", weights, weightFn,
 *         docType, department, entity, asOfDate, version, auth }
 * Returns candidates sorted by evidenceScore desc, each with
 * { features, weights, weightSource, evidenceScore, explanation, scoreDetails }.
 * Adds `scoringMeta` (own property): { weightSource, weights, filteredOut, scored }.
 */
function scoreCandidates(query, candidates, opts = {}) {
  const { kept, removed } = applyHardFilters(candidates, opts.auth);

  // Detect query signals once (single source: features.detectSignals) so the
  // weight function sees the same date/version/entity mentions as extraction.
  const signals = detectSignals(query, opts);
  const weightOpts = {
    ...opts,
    hasDateOrVersion: signals.hasDateOrVersion,
    hasMetadataRequest: signals.hasMetadataRequest,
  };
  const resolved = resolveWeights(query, weightOpts);

  const scored = kept.map((c) => {
    const { features, details } = extractFeatures(query, c, opts);
    const { weights, source, reasons } = resolved;
    const raw = FEATURES.reduce((s, f) => s + weights[f] * features[f], 0);
    const evidenceScore = round4(Math.min(1, Math.max(0, raw)));
    const explanation = buildExplanation({
      score: evidenceScore,
      weights,
      weightSource: source,
      weightReasons: reasons,
      features,
      query,
      details,
    });
    return {
      ...c,
      features: { ...features },
      weights: { ...weights },
      weightSource: source,
      evidenceScore,
      explanation,
      scoreDetails: details,
    };
  });

  scored.sort((a, b) => b.evidenceScore - a.evidenceScore);
  scored.scoringMeta = {
    weightSource: scored.length > 0 ? scored[0].weightSource : (opts.weightMode === "adaptive" ? "adaptive" : "fixed"),
    weights: scored.length > 0 ? scored[0].weights : resolveWeights(query, opts).weights,
    filteredOut: removed.length,
    scored: scored.length,
  };
  return scored;
}

module.exports = {
  applyHardFilters,
  buildExplanation,
  scoreCandidates,
};
