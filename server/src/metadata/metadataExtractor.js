/**
 * Metadata Extractor
 * Extracts structural and informational metadata dimensions from text chunks.
 */

const { normalizeMetadata, DEFAULT_AUTHORITY } = require("./metadataSchema");

const STOPWORDS = new Set([
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "aren't",
  "as", "at", "be", "because", "been", "before", "being", "below", "between", "both", "but", "by",
  "can", "could", "did", "do", "does", "doing", "don't", "down", "during", "each", "few", "for",
  "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers", "herself", "him",
  "himself", "his", "how", "i", "if", "in", "into", "is", "isn't", "it", "it's", "its", "itself",
  "just", "me", "more", "most", "my", "myself", "no", "nor", "not", "now", "of", "off", "on", "once",
  "only", "or", "other", "our", "ours", "ourselves", "out", "over", "own", "same", "she", "should",
  "so", "some", "such", "than", "that", "the", "their", "theirs", "them", "themselves", "then",
  "there", "these", "they", "this", "those", "through", "to", "too", "under", "until", "up", "very",
  "was", "wasn't", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why",
  "with", "won't", "would", "you", "your", "yours", "yourself", "yourselves"
]);

function detectSectionTitle(text) {
  if (!text || typeof text !== "string") return null;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  // Check top 3 lines
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    const line = lines[i];
    // Markdown header
    const mdMatch = line.match(/^#{1,4}\s+(.+)$/);
    if (mdMatch) return mdMatch[1].slice(0, 80).trim();

    // Section label (e.g. "Section 2.1: Requirements", "Chapter 1")
    if (/^(section|chapter|part|appendix)\s+\d+[:.\s]/i.test(line) && line.length < 80) {
      return line.trim();
    }

    // Short all-caps line (e.g. "EXECUTIVE SUMMARY", "ELIGIBILITY CRITERIA")
    if (/^[A-Z0-9\s,–—:-]{4,60}$/.test(line) && line.split(/\s+/).length <= 8) {
      return line.trim();
    }
  }

  return null;
}

function computeInformationDensity(text) {
  if (!text || typeof text !== "string") return 0;
  const tokens = text.toLowerCase().match(/\b[a-z0-9_]{2,}\b/g) || [];
  if (tokens.length === 0) return 0;

  const contentTokens = tokens.filter((t) => !STOPWORDS.has(t));
  if (contentTokens.length === 0) return 0;

  const uniqueContent = new Set(contentTokens);
  // Ratio of distinct content words relative to total tokens, normalized to [0, 1]
  const density = uniqueContent.size / tokens.length;
  return Math.min(1, Math.max(0, parseFloat(density.toFixed(3))));
}

function extractChunkMetadata({ text, rawMetadata = {}, filename = null, pageNumber = null }) {
  const sectionTitle = rawMetadata.sectionTitle || detectSectionTitle(text);
  const infoDensity = computeInformationDensity(text);
  const words = (text || "").trim().split(/\s+/).filter(Boolean).length;

  return normalizeMetadata({
    ...rawMetadata,
    filename: filename || rawMetadata.filename,
    pageNumber: pageNumber ?? rawMetadata.pageNumber,
    sectionTitle,
    informationDensity: infoDensity,
    wordCount: words,
  });
}

module.exports = {
  detectSectionTitle,
  computeInformationDensity,
  extractChunkMetadata,
  STOPWORDS,
};

