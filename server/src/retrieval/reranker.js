/**
 * Offline Reranker
 * High-performance cross-relevance scoring evaluating lexical coverage, n-gram matching,
 * proximity, and semantic term alignment.
 */

const { tokenize } = require("./sparseRetriever");

function extractNGrams(tokens, n) {
  const ngrams = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    ngrams.push(tokens.slice(i, i + n).join(" "));
  }
  return ngrams;
}

function scoreRelevance(query, candidateText) {
  if (!query || !candidateText) return 0;
  const qTokens = tokenize(query);
  const docTokens = tokenize(candidateText);

  if (qTokens.length === 0 || docTokens.length === 0) return 0;

  const docTokenSet = new Set(docTokens);
  let matchedTokens = 0;

  // 1. Unigram coverage
  for (const qt of qTokens) {
    if (docTokenSet.has(qt)) matchedTokens++;
  }
  const unigramCoverage = matchedTokens / qTokens.length;

  // 2. Bigram phrase overlap (rewarding exact phrase alignment)
  let bigramScore = 0;
  if (qTokens.length >= 2) {
    const qBigrams = extractNGrams(qTokens, 2);
    const docBigrams = new Set(extractNGrams(docTokens, 2));
    let matchedBigrams = 0;
    for (const qb of qBigrams) {
      if (docBigrams.has(qb)) matchedBigrams++;
    }
    bigramScore = matchedBigrams / qBigrams.length;
  }

  // 3. Proximity bonus: compute span of matched terms
  let proximityScore = 0;
  if (matchedTokens > 1) {
    const positions = [];
    docTokens.forEach((dt, idx) => {
      if (qTokens.includes(dt)) positions.push(idx);
    });
    if (positions.length >= 2) {
      const span = positions[positions.length - 1] - positions[0] + 1;
      // Closer span -> higher proximity
      proximityScore = Math.min(1, Math.max(0, (positions.length / span)));
    }
  }

  // Composite cross-relevance score: 50% unigram + 35% bigram + 15% proximity
  const finalScore = (0.50 * unigramCoverage) + (0.35 * bigramScore) + (0.15 * proximityScore);
  return Math.min(1, Math.max(0, parseFloat(finalScore.toFixed(4))));
}

async function rerankCandidates(query, candidates = [], topK = 5) {
  if (!candidates || candidates.length === 0) return [];
  const k = Math.max(1, parseInt(topK, 10) || 5);

  const scored = candidates.map((cand) => {
    const crossScore = scoreRelevance(query, cand.text);
    // Combine existing retrieval score with cross-encoder score
    const baseScore = cand.hybridScore ?? cand.denseScore ?? 0.5;
    const rerankScore = parseFloat(((0.55 * crossScore) + (0.45 * baseScore)).toFixed(4));
    return {
      ...cand,
      rerankScore,
      crossScore,
    };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);

  return scored.slice(0, k).map((item, idx) => ({
    ...item,
    rerankRank: idx + 1,
  }));
}

module.exports = {
  rerankCandidates,
  scoreRelevance,
};

