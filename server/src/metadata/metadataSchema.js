/**
 * Metadata Schema for Enterprise Evidence Chunks
 * Defines multi-dimensional attributes: structural, authority, temporal, and informational.
 */

const DEFAULT_AUTHORITY = {
  document: 1.0,
  web: 0.7,
  unknown: 0.5,
};

function normalizeMetadata(raw = {}) {
  const sourceType = raw.sourceType === "web" ? "web" : "document";
  const authorityScore = typeof raw.authorityScore === "number"
    ? Math.max(0, Math.min(1, raw.authorityScore))
    : (DEFAULT_AUTHORITY[sourceType] ?? 0.8);

  const informationDensity = typeof raw.informationDensity === "number"
    ? Math.max(0, Math.min(1, raw.informationDensity))
    : 0.5;

  return {
    documentId: raw.documentId ? String(raw.documentId) : null,
    sourceId: raw.sourceId ? String(raw.sourceId) : null,
    filename: raw.filename || raw.title || "document",
    sourceType,
    chunkIndex: Number.isInteger(raw.chunkIndex) ? raw.chunkIndex : 0,
    pageNumber: Number.isInteger(raw.pageNumber) ? raw.pageNumber : (raw.page ? Number(raw.page) : null),
    sectionTitle: raw.sectionTitle ? String(raw.sectionTitle).slice(0, 120) : null,
    authorityScore,
    informationDensity,
    createdAt: raw.createdAt || raw.uploadedAt || raw.added_at || new Date().toISOString(),
    topic: raw.topic || null,
    url: raw.url || null,
  };
}

module.exports = {
  DEFAULT_AUTHORITY,
  normalizeMetadata,
};

