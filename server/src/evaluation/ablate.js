/**
 * Ablations: remove each feature/stage one at a time and report metric deltas
 * vs the full pipeline. Runs on cached retrieval pools (one retrieval pass).
 *
 * Weight ablations (semantic/keyword/metadata/temporal): the feature's weight
 * is zeroed per query (rules otherwise intact) before scoring + selection.
 * Stage ablations: coverage (selection without coverage guidance),
 * redundancy (penalty set to 0), conflict (detection skipped).
 * Coverage uses a single-requirement proxy (the query itself) so the module
 * stays offline and deterministic; this is documented, not hidden.
 */

const { assessCoverage } = require("../evidence/coverage");
const { selectEvidence } = require("../evidence/select");
const { detectConflicts } = require("../evidence/conflicts");
const { scoreCandidates } = require("../scoring/scorer");
const {
  FEATURES, DEFAULT_RULE_BOOSTS, normalizeWeights, queryDependentWeights,
} = require("../scoring/weights");
const {
  precisionAtK, recallAtK, reciprocalRank, ndcgAtK, evidenceCoverage,
  redundancyRate, conflictCorrectness,
} = require("./evalMetrics");
const { collectPools } = require("./tune");
const { getDb } = require("../database/db");

const ABLATIONS = [
  { name: "no-semantic", removed: "semantic" },
  { name: "no-keyword", removed: "keyword" },
  { name: "no-metadata", removed: "metadata" },
  { name: "no-temporal", removed: "temporal" },
  { name: "no-coverage", removed: "coverage" },
  { name: "no-redundancy", removed: "redundancy" },
  { name: "no-conflict", removed: "conflict" },
];

function requiredIdsOf(question) {
  try {
    const v = typeof question.required_evidence_ids === "string"
      ? JSON.parse(question.required_evidence_ids)
      : question.required_evidence_ids;
    return (Array.isArray(v) ? v : []).map(String);
  } catch { return []; }
}

function ablatedWeightFn(removed) {
  return (q, o) => {
    const base = queryDependentWeights(q, { ...o, ruleBoosts: { ...DEFAULT_RULE_BOOSTS } });
    const w = { ...base.weights, [removed]: 0 };
    return normalizeWeights(w);
  };
}

async function runVariant(pools, variant, opts = {}) {
  const topK = Math.max(1, parseInt(opts.topK, 10) || 5);
  const rows = [];
  for (const { question, pool, error } of pools) {
    if (error || pool.length === 0) {
      rows.push({ question_id: question.id, question_type: question.question_type, coverage: 0, recall: 0, mrr: 0, ndcg: 0, precision: 0, conflict: null });
      continue;
    }
    const required = requiredIdsOf(question);
    const scoringOpts = variant && FEATURES.includes(variant.removed)
      ? { weightMode: "adaptive", weightFn: ablatedWeightFn(variant.removed) }
      : { weightMode: "adaptive" };
    const scored = scoreCandidates(question.query, pool, scoringOpts);
    const requirements = [{ id: "r1", text: question.query }];
    const coverage = await assessCoverage(requirements, scored, { method: "lexical" });
    const selOpts = { topK, redundancyPenalty: variant && variant.removed === "redundancy" ? 0 : undefined };
    const { selected } = variant && variant.removed === "coverage"
      ? selectEvidence(requirements, scored, { chunkCovers: {} }, selOpts)
      : selectEvidence(requirements, scored, coverage, selOpts);
    const top = selected.slice(0, topK);
    const conflicts = variant && variant.removed === "conflict" ? [] : detectConflicts(top);
    const preferred = conflicts.length > 0 ? conflicts[0].preferredChunkId : null;
    rows.push({
      question_id: question.id,
      question_type: question.question_type,
      coverage: evidenceCoverage(top, required),
      recall: recallAtK(top, required, topK),
      mrr: reciprocalRank(top, required),
      ndcg: ndcgAtK(top, required, topK),
      precision: precisionAtK(top, required, topK),
      conflict: conflictCorrectness(question, { conflictsDetected: conflicts, preferredChunkId: preferred }),
    });
  }
  return rows;
}

function average(rows) {
  const mean = (f) => {
    const vals = rows.map(f).filter((v) => typeof v === "number");
    return vals.length === 0 ? null : vals.reduce((s, v) => s + v, 0) / vals.length;
  };
  return {
    coverage: mean((r) => r.coverage),
    recall: mean((r) => r.recall),
    mrr: mean((r) => r.mrr),
    ndcg: mean((r) => r.ndcg),
    precision: mean((r) => r.precision),
    conflict: mean((r) => r.conflict),
  };
}

/**
 * runAblations(opts): { split|questions, db, poolSize, topK, retrieve, pools }
 * Returns { baseline, variants: [{ name, removed, metrics, deltas, rows }] }.
 * Deltas are variant-minus-baseline (negative = removing the feature hurt).
 */
async function runAblations(opts = {}) {
  const db = opts.db || getDb();
  const questions = opts.questions ||
    db.prepare("SELECT * FROM evaluation_questions WHERE split = ? ORDER BY id").all(opts.split || "validation");
  if (questions.length === 0) throw new Error("no evaluation questions for ablations");
  const pools = opts.pools || (await collectPools(questions, opts));
  const baseRows = await runVariant(pools, null, opts);
  const baseline = average(baseRows);
  const variants = [];
  for (const v of ABLATIONS) {
    const rows = await runVariant(pools, v, opts);
    const metrics = average(rows);
    const deltas = {};
    for (const k of Object.keys(baseline)) {
      deltas[k] = metrics[k] === null || baseline[k] === null
        ? null
        : parseFloat((metrics[k] - baseline[k]).toFixed(4));
    }
    variants.push({ name: v.name, removed: v.removed, metrics, deltas, rows });
  }
  return { baseline, baselineRows: baseRows, variants, questionCount: questions.length, topK: opts.topK || 5 };
}

module.exports = { runAblations, ABLATIONS };
