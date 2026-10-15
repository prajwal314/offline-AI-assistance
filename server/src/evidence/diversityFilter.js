/**
 * Diversity Filter (Redundancy Mitigation)
 * Prevents redundant/duplicate chunks from monopolizing Top-K context.
 */

const { tokenize } = require("../retrieval/sparseRetriever");

function computeJaccardSimilarity(textA, textB) {
  const setA = new Set(tokenize(textA));
  const setB = new Set(tokenize(textB));
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function filterRedundantChunks(candidates = [], maxSimilarity = 0.70) {
  if (!candidates || candidates.length <= 1) return candidates;

  const selected = [];

  for (const candidate of candidates) {
    let isRedundant = false;

    for (const chosen of selected) {
      // Check if from same document and adjacent/overlapping
      const sameDoc = candidate.metadata?.documentId && candidate.metadata?.documentId === chosen.metadata?.documentId;
      const sim = computeJaccardSimilarity(candidate.text, chosen.text);

      if (sim > maxSimilarity || (sameDoc && sim > 0.60)) {
        isRedundant = true;
        break;
      }
    }

    if (!isRedundant) {
      selected.push(candidate);
    }
  }

  return selected;
}

module.exports = {
  filterRedundantChunks,
  computeJaccardSimilarity,
};

