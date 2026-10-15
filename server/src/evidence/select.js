/**
 * Greedy evidence selection (Change 4, step 3).
 * Maximizes sub-requirement coverage while applying redundancy as a SOFT
 * penalty (text overlap + score proximity). Hard guarantee: a chunk that is
 * the ONLY coverer of a sub-requirement is always kept, no matter how
 * similar it is to already-selected chunks (similar chunks can hold
 * different facts).
 */

const { computeJaccardSimilarity } = require("./diversityFilter");

const DEFAULT_TOP_K = 5;
const COVERAGE_WEIGHT = 1.0;
const SCORE_WEIGHT = 0.5;
const REDUNDANCY_PENALTY = 0.4;

function chunkIdOf(c, i) {
  return String(c?.chunkId ?? c?.id ?? `c${i}`);
}

function normScore(c) {
  const s = c?.evidenceScore ?? c?.score ?? c?.rerankScore ?? c?.denseScore ?? 0.5;
  return typeof s === "number" ? Math.min(1, Math.max(0, s)) : 0.5;
}

function redundancyToSelected(chunk, selected, similarityFn) {
  if (selected.length === 0) return 0;
  const sim = similarityFn || computeJaccardSimilarity;
  let max = 0;
  for (const s of selected) {
    let v = 0;
    try {
      v = sim(chunk.text || "", s.text || "");
    } catch {
      v = 0;
    }
    // Small proximity term: near-identical scores add mild redundancy signal.
    const scoreGap = Math.abs(normScore(chunk) - normScore(s));
    v = 0.85 * v + 0.15 * (1 - scoreGap);
    if (v > max) max = v;
  }
  return max;
}

/**
 * selectEvidence(requirements, candidates, coverage, opts)
 * coverage: result of assessCoverage (uses .chunkCovers + .perRequirement).
 * opts: { topK, coverageWeight, scoreWeight, redundancyPenalty, similarityFn }
 * -> { selected, decisions: [{chunkId, action, reason, gain, covers}] }
 */
function selectEvidence(requirements, candidates, coverage, opts = {}) {
  const topK = Math.max(1, parseInt(opts.topK, 10) || DEFAULT_TOP_K);
  const wCov = opts.coverageWeight ?? COVERAGE_WEIGHT;
  const wScore = opts.scoreWeight ?? SCORE_WEIGHT;
  const wRed = opts.redundancyPenalty ?? REDUNDANCY_PENALTY;
  const list = Array.isArray(candidates) ? [...candidates] : [];
  const covers = coverage?.chunkCovers || {};
  const byId = new Map(list.map((c, i) => [chunkIdOf(c, i), { c, i }]));

  const selected = [];
  const selectedIds = new Set();
  const coveredReqs = new Set();
  const decisions = [];
  const decide = (c, i, action, reason, gain, coversReqs) => {
    decisions.push({ chunkId: chunkIdOf(c, i), action, reason, gain: round3(gain), covers: coversReqs });
  };

  const coversOf = (c, i) => (covers[chunkIdOf(c, i)] || []).map((e) => e.requirementId);

  // Phase 1 (mandatory): every coverable requirement keeps its best chunk.
  // Best = highest evidence score, tie-break by breadth of coverage.
  const reqSole = {}; // requirementId -> [chunkIds covering it]
  for (const [cid, entries] of Object.entries(covers)) {
    for (const e of entries) {
      (reqSole[e.requirementId] = reqSole[e.requirementId] || []).push(cid);
    }
  }
  const reqOrder = Array.isArray(requirements) ? requirements.map((r) => r.id) : Object.keys(reqSole);
  for (const rid of reqOrder) {
    if (coveredReqs.has(rid) || selected.length >= topK) break;
    const coverers = (reqSole[rid] || []).filter((cid) => byId.has(cid) && !selectedIds.has(cid));
    if (coverers.length === 0) continue;
    coverers.sort((a, b) => {
      const ca = byId.get(a).c;
      const cb = byId.get(b).c;
      const ds = normScore(cb) - normScore(ca);
      if (ds !== 0) return ds;
      return coversOf(cb, byId.get(b).i).length - coversOf(ca, byId.get(a).i).length;
    });
    const pick = coverers[0];
    const { c, i } = byId.get(pick);
    selected.push(c);
    selectedIds.add(pick);
    for (const r of coversOf(c, i)) coveredReqs.add(r);
    const sole = reqSole[rid].length === 1;
    decide(c, i, "selected", sole ? `only chunk covering ${rid}` : `best chunk covering ${rid}`, wCov + wScore * normScore(c), coversOf(c, i));
  }

  // Phase 2 (greedy fill): gain = coverage gain + score - redundancy penalty.
  while (selected.length < topK) {
    let best = null;
    for (const [cid, { c, i }] of byId) {
      if (selectedIds.has(cid)) continue;
      const mine = coversOf(c, i);
      const fresh = mine.filter((r) => !coveredReqs.has(r)).length;
      const red = redundancyToSelected(c, selected, opts.similarityFn);
      const gain = wCov * fresh + wScore * normScore(c) - wRed * red;
      if (!best || gain > best.gain) best = { c, i, cid, gain, fresh, red, mine };
    }
    if (!best || best.gain <= 0) break;
    selected.push(best.c);
    selectedIds.add(best.cid);
    for (const r of best.mine) coveredReqs.add(r);
    decide(best.c, best.i, "selected", best.fresh > 0 ? `covers ${best.fresh} new requirement(s)` : "high score, low redundancy", best.gain, best.mine);
  }

  // Everything else is skipped (logged for the debug object).
  for (const [cid, { c, i }] of byId) {
    if (selectedIds.has(cid)) continue;
    const mine = coversOf(c, i);
    const red = redundancyToSelected(c, selected, opts.similarityFn);
    decide(c, i, "skipped", mine.length === 0 ? "covers no sub-requirement" : "lower gain than selected chunks", wScore * normScore(c) - wRed * red, mine);
  }

  return { selected, decisions };
}

function round3(n) {
  return parseFloat(Number(n).toFixed(3));
}

module.exports = {
  selectEvidence,
  redundancyToSelected,
  DEFAULT_TOP_K,
  COVERAGE_WEIGHT,
  SCORE_WEIGHT,
  REDUNDANCY_PENALTY,
};
