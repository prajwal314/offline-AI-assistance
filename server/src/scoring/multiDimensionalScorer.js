/**
 * Multi-Dimensional Evidence Scorer
 * Aggregates semantic, lexical, cross-relevance, authority, structural, and informational scores.
 */

const { tokenize } = require("../retrieval/sparseRetriever");

const DEFAULT_WEIGHTS = {
  semantic: 0.35,
  lexical: 0.20,
  rerank: 0.25,
  authority: 0.10,
  density: 0.05,
  section: 0.05,
};

function scoreSectionRelevance(query, sectionTitle) {
  if (!sectionTitle || sectionTitle === "General" || !query) return 0.5;
  const qTokens = tokenize(query);
  const sTokens = tokenize(sectionTitle);
  if (qTokens.length === 0 || sTokens.length === 0) return 0.5;

  const sSet = new Set(sTokens);
  let matched = 0;
  for (const qt of qTokens) {
    if (sSet.has(qt)) matched++;
  }
  return matched > 0 ? Math.min(1, 0.5 + 0.5 * (matched / qTokens.length)) : 0.5;
}

function scoreCandidate(query, candidate, weights = DEFAULT_WEIGHTS) {
  const meta = candidate.metadata || {};

  const sSemantic = candidate.denseScore ?? 0.5;
  const sLexical = candidate.sparseScore ?? 0.0;
  const sRerank = candidate.crossScore ?? candidate.rerankScore ?? sSemantic;
  const sAuthority = meta.authorityScore ?? 0.8;
  const sDensity = meta.informationDensity ?? 0.5;
  const sSection = scoreSectionRelevance(query, meta.sectionTitle);

  const w = { ...DEFAULT_WEIGHTS, ...weights };
  const totalWeight = w.semantic + w.lexical + w.rerank + w.authority + w.density + w.section;

  const rawEvidenceScore =
    (w.semantic * sSemantic) +
    (w.lexical * sLexical) +
    (w.rerank * sRerank) +
    (w.authority * sAuthority) +
    (w.density * sDensity) +
    (w.section * sSection);

  const normalizedEvidenceScore = Math.min(1, Math.max(0, rawEvidenceScore / (totalWeight || 1)));

  return {
    ...candidate,
    evidenceScore: parseFloat(normalizedEvidenceScore.toFixed(4)),
    dimensionBreakdown: {
      semantic: parseFloat(sSemantic.toFixed(4)),
      lexical: parseFloat(sLexical.toFixed(4)),
      rerank: parseFloat(sRerank.toFixed(4)),
      authority: parseFloat(sAuthority.toFixed(4)),
      density: parseFloat(sDensity.toFixed(4)),
      section: parseFloat(sSection.toFixed(4)),
    },
  };
}

function scoreMultiDimensional(query, candidates = [], weights = DEFAULT_WEIGHTS) {
  const scored = candidates.map((c) => scoreCandidate(query, c, weights));
  scored.sort((a, b) => b.evidenceScore - a.evidenceScore);
  return scored;
}

module.exports = {
  scoreMultiDimensional,
  scoreCandidate,
  scoreSectionRelevance,
  DEFAULT_WEIGHTS,
};

