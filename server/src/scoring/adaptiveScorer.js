/**
 * Adaptive Scorer
 * Classifies query intent and dynamically allocates dimensional weights & sufficiency thresholds.
 */

const { scoreMultiDimensional, DEFAULT_WEIGHTS } = require("./multiDimensionalScorer");

const INTENT_WEIGHTS = {
  factoid: {
    semantic: 0.20,
    lexical: 0.35,
    rerank: 0.30,
    authority: 0.05,
    density: 0.05,
    section: 0.05,
  },
  definitional: {
    semantic: 0.45,
    lexical: 0.10,
    rerank: 0.20,
    authority: 0.10,
    density: 0.10,
    section: 0.05,
  },
  structural: {
    semantic: 0.20,
    lexical: 0.15,
    rerank: 0.20,
    authority: 0.15,
    density: 0.05,
    section: 0.25,
  },
  general: DEFAULT_WEIGHTS,
};

const BASE_THRESHOLDS = {
  factoid: 0.35,
  definitional: 0.30,
  structural: 0.32,
  general: 0.28,
};

function classifyQueryIntent(query = "") {
  const q = String(query).toLowerCase().trim();

  // Structural questions
  if (/\b(section|chapter|part|appendix|clause|table|schedule|article)\b/i.test(q)) {
    return "structural";
  }

  // Factoid questions (exact dates, numbers, counts, scores, percentages)
  if (
    /\b(how many|how much|when|what date|what year|percentage|score|fee|cost|eligibility criteria|marks|cutoff)\b/i.test(q) ||
    /\b\d{2,4}\b/.test(q)
  ) {
    return "factoid";
  }

  // Definitional / conceptual questions
  if (/\b(what is|explain|describe|overview|summarize|definition of|meaning of)\b/i.test(q)) {
    return "definitional";
  }

  return "general";
}

function scoreAdaptive(query, candidates = []) {
  const intent = classifyQueryIntent(query);
  const weights = INTENT_WEIGHTS[intent] || INTENT_WEIGHTS.general;
  const scored = scoreMultiDimensional(query, candidates, weights);
  const minThreshold = BASE_THRESHOLDS[intent] || BASE_THRESHOLDS.general;

  // Filter candidates below dynamic sufficiency threshold
  const sufficient = scored.filter((c) => c.evidenceScore >= minThreshold);

  return {
    results: sufficient.length > 0 ? sufficient : [],
    intent,
    appliedWeights: weights,
    sufficiencyThreshold: minThreshold,
    candidateCount: candidates.length,
    filteredCount: candidates.length - sufficient.length,
  };
}

module.exports = {
  classifyQueryIntent,
  scoreAdaptive,
  INTENT_WEIGHTS,
  BASE_THRESHOLDS,
};

