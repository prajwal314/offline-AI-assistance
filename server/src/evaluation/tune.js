/**
 * Weight tuning (validation split ONLY — never the test split).
 * Retrieval pools are collected ONCE per question; trials only re-run the
 * pure scoring stage, so a 40-trial search costs one retrieval pass.
 * Grid or seeded random search over fixed weights and/or rule boosts.
 * Use reportOnTest() afterwards to report the winner on the test split.
 */

const { getDb } = require("../database/db");
const { retrieve } = require("../retrieval/index");
const { scoreCandidates } = require("../scoring/scorer");
const {
  FEATURES, DEFAULT_WEIGHTS, DEFAULT_RULE_BOOSTS,
  normalizeWeights, queryDependentWeights,
} = require("../scoring/weights");
const {
  precisionAtK, recallAtK, reciprocalRank, ndcgAtK, evidenceCoverage,
} = require("./evalMetrics");

function requiredIdsOf(question) {
  try {
    const v = typeof question.required_evidence_ids === "string"
      ? JSON.parse(question.required_evidence_ids)
      : question.required_evidence_ids;
    return (Array.isArray(v) ? v : []).map(String);
  } catch { return []; }
}

function chunkIdOf(c, i) {
  return String(c?.chunkId ?? c?.id ?? `c${i}`);
}

// Seeded PRNG for reproducible random search.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function trialToScoringOpts(trial) {
  if (trial.weights) return { weights: trial.weights };
  return {
    weightMode: "adaptive",
    weightFn: (q, o) => queryDependentWeights(q, { ...o, ruleBoosts: trial.boosts }).weights,
  };
}

function trialLabel(trial) {
  if (trial.weights) return `fixed[${FEATURES.map((f) => trial.weights[f].toFixed(2)).join(",")}]`;
  const b = trial.boosts;
  return `rules[k=${b.keyword.toFixed(2)},t=${b.temporal.toFixed(2)},m=${b.metadata.toFixed(2)}]`;
}

function candidateTrials({ search = "random", trials = 40, seed = 42 } = {}) {
  const out = [];
  const seen = new Set();
  const push = (t) => {
    const key = trialLabel(t);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  // Always include the defaults so "tuned" is compared against them honestly.
  push({ weights: { ...DEFAULT_WEIGHTS } });
  push({ boosts: { ...DEFAULT_RULE_BOOSTS } });
  if (search === "grid") {
    const steps = [0, 1 / 3, 2 / 3, 1];
    for (const s of steps) for (const k of steps) for (const m of steps) for (const t of steps) {
      if (s + k + m + t <= 0) continue;
      push({ weights: normalizeWeights({ semantic: s, keyword: k, metadata: m, temporal: t }) });
    }
  } else {
    const rnd = mulberry32(seed);
    for (let i = 0; i < trials; i++) {
      if (rnd() < 0.5) {
        const raw = {};
        for (const f of FEATURES) raw[f] = rnd();
        push({ weights: normalizeWeights(raw) });
      } else {
        push({
          boosts: {
            keyword: round3(rnd() * 0.3),
            temporal: round3(rnd() * 0.3),
            metadata: round3(rnd() * 0.3),
          },
        });
      }
    }
  }
  return out;
}

function round3(n) {
  return parseFloat(Number(n).toFixed(3));
}

const OBJECTIVES = {
  composite: (m) => (m.coverage + m.recall + m.mrr + m.ndcg) / 4,
  coverage: (m) => m.coverage,
  recall: (m) => m.recall,
};

async function collectPools(questions, opts = {}) {
  const poolSize = Math.max(1, parseInt(opts.poolSize, 10) || 20);
  const retrieveFn = opts.retrieve || ((q, rOpts) => retrieve(q, rOpts));
  const pools = [];
  for (const q of questions) {
    let pool = [];
    try {
      pool = (await retrieveFn(q.query, { mode: "hybrid_rerank", topK: poolSize })) || [];
    } catch (err) {
      pools.push({ question: q, pool: [], error: String(err.message || err).slice(0, 200) });
      continue;
    }
    pools.push({ question: q, pool });
  }
  return pools;
}

function scorePools(pools, trial, opts = {}) {
  const topK = Math.max(1, parseInt(opts.topK, 10) || 5);
  const scoringOpts = trialToScoringOpts(trial);
  const rows = pools.map(({ question, pool, error }) => {
    if (error || pool.length === 0) {
      return { question_id: question.id, coverage: 0, recall: 0, mrr: 0, ndcg: 0, precision: 0, error: error || "empty pool" };
    }
    const required = requiredIdsOf(question);
    const scored = scoreCandidates(question.query, pool, scoringOpts).slice(0, topK);
    return {
      question_id: question.id,
      coverage: evidenceCoverage(scored, required),
      recall: recallAtK(scored, required, topK),
      mrr: reciprocalRank(scored, required),
      ndcg: ndcgAtK(scored, required, topK),
      precision: precisionAtK(scored, required, topK),
      error: null,
    };
  });
  const mean = (f) => rows.reduce((s, r) => s + f(r), 0) / Math.max(1, rows.length);
  const metrics = {
    coverage: mean((r) => r.coverage),
    recall: mean((r) => r.recall),
    mrr: mean((r) => r.mrr),
    ndcg: mean((r) => r.ndcg),
    precision: mean((r) => r.precision),
  };
  return { rows, metrics };
}

/**
 * tuneWeights(opts): search on the VALIDATION split only.
 * Throws if opts.split === 'test'. Pass opts.questions (tests) or opts.db.
 */
async function tuneWeights(opts = {}) {
  const split = opts.split || "validation";
  if (split === "test") {
    throw new Error("refusing to tune on the test split (use 'validation')");
  }
  const db = opts.db || getDb();
  const questions = opts.questions || db.prepare("SELECT * FROM evaluation_questions WHERE split = ? ORDER BY id").all(split);
  if (questions.length === 0) throw new Error(`no evaluation questions in split "${split}"`);
  const objectiveFn = OBJECTIVES[opts.objective] || OBJECTIVES.composite;
  const trials = candidateTrials({ search: opts.search, trials: opts.trials, seed: opts.seed ?? 42 });
  const pools = await collectPools(questions, opts);
  const scored = trials.map((trial) => {
    const { rows, metrics } = scorePools(pools, trial, opts);
    return { config: trial, label: trialLabel(trial), objective: objectiveFn(metrics), metrics, rows };
  });
  scored.sort((a, b) => b.objective - a.objective);
  return {
    split,
    objective: opts.objective || "composite",
    questionCount: questions.length,
    poolSize: opts.poolSize || 20,
    topK: opts.topK || 5,
    trials: scored,
    best: scored[0],
  };
}

/** Score one config on a (test-split) pool set for honest reporting. */
async function reportOnTest(config, opts = {}) {
  const split = opts.split || "test";
  const db = opts.db || getDb();
  const questions = opts.questions || db.prepare("SELECT * FROM evaluation_questions WHERE split = ? ORDER BY id").all(split);
  if (questions.length === 0) throw new Error(`no evaluation questions in split "${split}"`);
  const pools = await collectPools(questions, opts);
  const { rows, metrics } = scorePools(pools, config, opts);
  const objectiveFn = OBJECTIVES[opts.objective] || OBJECTIVES.composite;
  return { split, questionCount: questions.length, metrics, objective: objectiveFn(metrics), rows };
}

module.exports = {
  tuneWeights,
  reportOnTest,
  collectPools,
  scorePools,
  candidateTrials,
  trialToScoringOpts,
  trialLabel,
  OBJECTIVES,
};
