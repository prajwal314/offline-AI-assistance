/**
 * Evidence assembler (Change 4, orchestration).
 * decompose -> retrieve -> coverage -> greedy select -> conflicts ->
 * sufficiency (bounded retries, default max 2) -> verdict + debug object.
 *
 * assembleEvidence(question, retrieveFn, opts) where
 *   retrieveFn(question, topK, attemptIndex) -> Promise<candidates>
 * returns { selected, coverage, conflicts, verdict, message, debug }.
 * The debug object (requirements, attempts, scores, coverage, decisions)
 * is shaped for the evaluation module to consume directly.
 */

const { decomposeQuestion } = require("./decompose");
const { assessCoverage } = require("./coverage");
const { selectEvidence } = require("./select");
const { detectConflicts } = require("./conflicts");
const { decideVerdict } = require("./sufficiency");

const MAX_RETRIES = Number(process.env.EVIDENCE_MAX_RETRIES) || 2;
const RETRY_TOPK_STEP = 5;

function chunkIdOf(c, i) {
  return String(c?.chunkId ?? c?.id ?? `c${i}`);
}

async function assembleEvidence(question, retrieveFn, opts = {}) {
  const t0 = Date.now();
  const topK = Math.max(1, parseInt(opts.topK, 10) || 5);
  const maxRetries = opts.maxRetries ?? MAX_RETRIES;
  const minCoverage = opts.minCoverage ?? 1.0;
  const coverageOpts = {
    method: opts.coverageMethod,
    threshold: opts.coverageThreshold,
    embedFn: opts.embedFn,
    judgeFn: opts.judgeFn,
  };
  const selectOpts = {
    topK,
    coverageWeight: opts.coverageWeight,
    scoreWeight: opts.scoreWeight,
    redundancyPenalty: opts.redundancyPenalty,
    similarityFn: opts.similarityFn,
  };

  const { requirements, method: decompMethod, latencyMs: decompMs } = await decomposeQuestion(
    question,
    { fetchFn: opts.decomposeFetchFn }
  );

  const pool = new Map();
  const attempts = [];
  let coverage = null;
  let attempt = 0;

  // Bounded retrieval loop: grow topK on retry, accumulate the pool.
  for (;;) {
    const attemptTopK = topK + attempt * RETRY_TOPK_STEP;
    let fresh = [];
    try {
      fresh = (await retrieveFn(question, attemptTopK, attempt)) || [];
    } catch (err) {
      attempts.push({ attempt, topK: attemptTopK, error: String(err.message || err).slice(0, 200) });
      break;
    }
    for (const c of fresh) {
      const id = chunkIdOf(c, pool.size);
      if (!pool.has(id)) pool.set(id, c);
    }
    coverage = await assessCoverage(requirements, [...pool.values()], coverageOpts);
    attempts.push({
      attempt,
      topK: attemptTopK,
      freshCount: fresh.length,
      poolSize: pool.size,
      coverageRatio: coverage.coverageRatio,
      uncovered: coverage.uncovered,
    });
    const verdict = decideVerdict({
      coverageRatio: coverage.coverageRatio,
      uncovered: coverage.uncovered,
      conflicts: [],
      retriesExhausted: attempt >= maxRetries,
      minCoverage,
    });
    if (verdict !== "retry") break;
    attempt++;
  }

  const { selected, decisions } = selectEvidence(requirements, [...pool.values()], coverage, selectOpts);
  // Re-assess coverage on the final selection (what the answer actually uses).
  const selectedCoverage = await assessCoverage(requirements, selected, coverageOpts);
  const conflicts = detectConflicts(selected);
  const verdict = decideVerdict({
    coverageRatio: selectedCoverage.coverageRatio,
    uncovered: selectedCoverage.uncovered,
    conflicts,
    retriesExhausted: true,
    minCoverage,
  });

  const uncoveredTexts = selectedCoverage.perRequirement
    .filter((p) => !p.covered)
    .map((p) => p.text);
  const message =
    verdict === "abstain"
      ? `I could not find enough relevant information in the knowledge base to answer this question.${uncoveredTexts.length > 0 ? ` Missing: ${uncoveredTexts.join("; ")}.` : ""}`
      : verdict === "qualified"
        ? conflicts.map((c) => c.summary).join(" ")
        : null;

  const debug = {
    requirements,
    decomposition: { method: decompMethod, latencyMs: decompMs },
    attempts,
    retriesUsed: Math.max(0, attempts.length - 1),
    poolSize: pool.size,
    coverage: {
      ratio: selectedCoverage.coverageRatio,
      method: selectedCoverage.method,
      perRequirement: selectedCoverage.perRequirement,
      uncovered: selectedCoverage.uncovered,
    },
    selected: selected.map((c) => ({
      chunkId: chunkIdOf(c, 0),
      evidenceScore: c.evidenceScore ?? c.score ?? null,
      covers: (selectedCoverage.chunkCovers[chunkIdOf(c, 0)] || []).map((e) => e.requirementId),
    })),
    decisions,
    conflicts,
    verdict,
    latencyMs: Date.now() - t0,
  };

  return { selected, coverage: selectedCoverage, conflicts, verdict, message, debug };
}

module.exports = { assembleEvidence, MAX_RETRIES };
