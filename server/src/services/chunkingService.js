const DEFAULT_CHUNK_SIZE = 600;
const DEFAULT_OVERLAP = 100;

function splitIntoSentences(text) {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned) return [];
  const sentences = cleaned.split(/(?<=[.!?])\s+/);
  return sentences.filter((s) => s.trim().length > 0);
}

function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap || DEFAULT_OVERLAP;

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return [];
  }

  const sentences = splitIntoSentences(text);
  const chunks = [];
  let currentWords = [];
  let currentTextParts = [];

  function flushChunk() {
    if (currentWords.length === 0) return;
    const chunkStr = currentTextParts.join(" ").trim();
    if (chunkStr.length > 0) {
      chunks.push(chunkStr);
    }
  }

  for (const sentence of sentences) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    if (currentWords.length + words.length > chunkSize && currentWords.length > 0) {
      flushChunk();
      const overlapWords = currentWords.slice(-overlap);
      currentWords = [...overlapWords];
      currentTextParts = [overlapWords.join(" ")];
    }

    currentWords.push(...words);
    currentTextParts.push(sentence.trim());
  }

  flushChunk();

  if (chunks.length === 0 && text.trim().length > 0) {
    const words = text.trim().split(/\s+/);
    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      chunks.push(words.slice(i, i + chunkSize).join(" "));
    }
  }

  return chunks;
}

function chunkDocument({ text, pages, documentId, filename, pageNumber = null }) {
  const results = [];
  if (Array.isArray(pages) && pages.length > 0) {
    for (const p of pages) {
      const pageChunks = chunkText(p.text || "");
      for (const ct of pageChunks) {
        results.push({
          text: ct,
          metadata: {
            documentId: String(documentId),
            filename: filename || "unknown",
            chunkIndex: results.length,
            sourceType: "document",
            pageNumber: Number.isInteger(p.pageNumber) ? p.pageNumber : (p.pageNumber || null),
          },
        });
      }
    }
  } else {
    const rawChunks = chunkText(text);
    rawChunks.forEach((ct, index) => {
      results.push({
        text: ct,
        metadata: {
          documentId: String(documentId),
          filename: filename || "unknown",
          chunkIndex: index,
          sourceType: "document",
          ...(pageNumber !== null ? { pageNumber } : {}),
        },
      });
    });
  }

  // Reassign sequential chunk indices regardless of page grouping.
  results.forEach((r, i) => { r.metadata.chunkIndex = i; });
  return results;
}

module.exports = {
  chunkText,
  chunkDocument,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_OVERLAP,
};
