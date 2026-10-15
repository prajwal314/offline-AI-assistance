// Version 2 orchestrator — Confidence-Aware RAG decision flow.
//
// Exact decision flow (also documented for the research paper):
//   1. Initial retrieval with the EXISTING configuration (same Top-K,
//      same threshold, same session filter — never silently altered).
//   2. Evidence sufficiency check #1.
//   3. If sufficient                    → ANSWER (no retry).
//   4. If insufficient                   → refine the query ONCE, re-retrieve
//                                          ONCE with identical settings.
//   5. Evidence check #2 on merged (deduped) evidence.
//   6. If sufficient after retry         → ANSWER (recovered = true).
//   7. If still insufficient              → ABSTAIN.
//   8. Any technical failure (embedding/Chroma/LLM) propagates as a
//      technical ERROR — never disguised as an abstention.
//
// At most ONE refinement-and-retrieval retry per question, enforced
// structurally (a single if-block; retryCount is capped at MAX_RETRIES).

const { searchKnowledgeBase } = require("./retrievalService");
const { checkEvidenceSufficiency, refineQuery, MAX_RETRIES } = require("./evidenceService");

function dedupeChunks(first, second) {
  const seen = new Set();
  const merged = [];
  for (const c of [...(first || []), ...(second || [])]) {
    const key = c.id || `${c.text || ""}`.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(c);
  }
  return merged;
}

async function runConfidenceAwareRetrieval(
  question,
  optsOrTopK = {},
  legacyOpts = undefined
) {
  // Backward compatibility: accept the legacy positional form
  // (question, topK, { threshold, filter, ... }) as well as the canonical
  // (question, { topK, threshold, filter, ... }). Without this, a positional
  // call silently drops threshold/filter (incl. the sessionId scope) because
  // destructuring a number yields all defaults and the third arg is ignored.
  let opts;
  if (typeof optsOrTopK === "number" || typeof optsOrTopK === "string") {
    opts = { topK: optsOrTopK, ...(legacyOpts || {}) };
  } else {
    opts = optsOrTopK || {};
  }
  const { topK = 5, threshold = null, filter = {}, searchFn = searchKnowledgeBase, checkFn = checkEvidenceSufficiency, refineFn = refineQuery } = opts;
  const started = Date.now();
  if (!question || typeof question !== "string" || question.trim().length === 0) {
    throw new Error("Question is required");
  }

  const trace = {
    version: 2,
    decision: null,
    retryOccurred: false,
    retryCount: 0,
    recovered: false,
    refinedQuery: null,
    refineError: null,
    initialCount: 0,
    secondCount: 0,
    finalCount: 0,
    latencyMs: 0,
  };

  // --- Step 1: initial retrieval (technical errors propagate as errors) ---
  const initial = await searchFn(question, topK, { threshold, filter });
  trace.initialResults = initial.results;
  trace.initialEvidence = null;
  trace.topK = initial.topK;
  trace.threshold = initial.threshold;
  trace.where = initial.where;
  trace.filteredCount = initial.filteredCount || 0;
  trace.initialCount = initial.results.length;

  // --- Step 2: evidence check #1 ---
  const evidence1 = await checkFn(question, initial.results);
  trace.initialEvidence = evidence1;

  if (evidence1.sufficient) {
    trace.decision = "answer";
    trace.chunks = initial.results;
    trace.finalEvidence = evidence1;
    trace.finalCount = initial.results.length;
    trace.latencyMs = Date.now() - started;
    return trace;
  }

  // --- Step 3: one refinement + one retry (MAX_RETRIES enforced) ---
  if (trace.retryCount >= MAX_RETRIES) {
    trace.decision = "abstain";
    trace.chunks = initial.results;
    trace.finalEvidence = evidence1;
    trace.finalCount = initial.results.length;
    trace.latencyMs = Date.now() - started;
    return trace;
  }
  let refined;
  try {
    refined = await refineFn(question);
  } catch (err) {
    // Refinement failed technically: no retry, abstain with the error recorded.
    trace.decision = "abstain";
    trace.refineError = String((err && err.message) || err).slice(0, 300);
    trace.chunks = initial.results;
    trace.finalEvidence = evidence1;
    trace.finalCount = initial.results.length;
    trace.latencyMs = Date.now() - started;
    return trace;
  }
  trace.retryOccurred = true;
  trace.retryCount = 1;
  trace.refinedQuery = refined;

  // --- Step 4: second retrieval with IDENTICAL settings (errors propagate) ---
  const second = await searchFn(refined, topK, { threshold, filter });
  trace.secondResults = second.results;
  trace.secondCount = second.results.length;

  // --- Step 5: evidence check #2 on merged, deduped evidence ---
  const merged = dedupeChunks(initial.results, second.results);
  const evidence2 = await checkFn(question, merged);
  trace.finalEvidence = evidence2;
  trace.chunks = merged;
  trace.finalCount = merged.length;

  if (evidence2.sufficient) {
    trace.decision = "answer";
    trace.recovered = true;
  } else {
    trace.decision = "abstain";
    trace.recovered = false;
  }
  trace.latencyMs = Date.now() - started;
  return trace;
}

module.exports = { runConfidenceAwareRetrieval, dedupeChunks };
