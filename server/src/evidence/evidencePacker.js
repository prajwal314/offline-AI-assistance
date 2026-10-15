/**
 * Evidence Packer
 * Prepares evidence chunks with confidence tags and structured audit metadata.
 */

function rateConfidence(score) {
  if (typeof score !== "number") return "UNKNOWN";
  if (score >= 0.65) return "HIGH";
  if (score >= 0.40) return "MEDIUM";
  return "LOW";
}

function packEvidence(chunks = []) {
  return chunks.map((c, idx) => {
    const meta = c.metadata || {};
    const score = c.evidenceScore ?? (c.denseScore ?? (c.distance != null ? Math.max(0, 1 - c.distance / 2) : 0.5));
    const confidence = rateConfidence(score);

    return {
      id: c.id,
      text: c.text,
      metadata: {
        ...meta,
        confidence,
        evidenceScore: score,
      },
      distance: c.distance ?? null,
      denseScore: c.denseScore ?? null,
      sparseScore: c.sparseScore ?? null,
      rerankScore: c.rerankScore ?? null,
      evidenceScore: score,
      dimensionBreakdown: c.dimensionBreakdown || null,
      rank: idx + 1,
    };
  });
}

module.exports = {
  packEvidence,
  rateConfidence,
};

