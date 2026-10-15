/**
 * Sparse (BM25) Retriever
 * High-precision lexical retrieval for acronyms, technical terms, and exact keywords.
 */

const { getAllChunks } = require("../services/chromaService");
const { normalizeMetadata } = require("../metadata/metadataSchema");
const { STOPWORDS } = require("../metadata/metadataExtractor");

function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const words = text.toLowerCase().match(/\b[a-z0-9_]{2,}\b/g) || [];
  return words.filter((w) => !STOPWORDS.has(w));
}

class BM25Index {
  constructor(docs = [], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.docs = docs;
    this.docCount = docs.length;
    this.docTokens = [];
    this.docLengths = [];
    this.avgDocLength = 0;
    this.df = new Map(); // Term -> document frequency
    this.idf = new Map();

    this.buildIndex();
  }

  buildIndex() {
    if (this.docCount === 0) return;
    let totalLength = 0;

    for (let i = 0; i < this.docCount; i++) {
      const tokens = tokenize(this.docs[i].text);
      this.docTokens.push(tokens);
      const len = tokens.length;
      this.docLengths.push(len);
      totalLength += len;

      const seen = new Set(tokens);
      for (const term of seen) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
    }

    this.avgDocLength = this.docCount > 0 ? totalLength / this.docCount : 0;

    // Precompute IDF for terms: Robertson-Spärck Jones formula with smoothing
    for (const [term, freq] of this.df.entries()) {
      const idfVal = Math.log(1 + (this.docCount - freq + 0.5) / (freq + 0.5));
      this.idf.set(term, Math.max(0.01, idfVal));
    }
  }

  scoreQuery(queryTokens) {
    if (this.docCount === 0 || queryTokens.length === 0) return [];

    const scores = new Array(this.docCount).fill(0);

    for (const qTerm of queryTokens) {
      const idf = this.idf.get(qTerm);
      if (!idf) continue;

      for (let i = 0; i < this.docCount; i++) {
        const tokens = this.docTokens[i];
        const docLen = this.docLengths[i] || 1;
        // Term frequency in doc
        let tf = 0;
        for (let j = 0; j < tokens.length; j++) {
          if (tokens[j] === qTerm) tf++;
        }
        if (tf === 0) continue;

        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / (this.avgDocLength || 1)));
        scores[i] += idf * (numerator / denominator);
      }
    }

    const results = [];
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i] > 0) {
        results.push({ doc: this.docs[i], rawScore: scores[i] });
      }
    }

    results.sort((a, b) => b.rawScore - a.rawScore);
    return results;
  }
}

async function retrieveSparse(query, topK = 5, where = null) {
  if (!query || typeof query !== "string") return [];
  const k = Math.max(1, parseInt(topK, 10) || 5);
  const chunks = await getAllChunks(where);
  if (!chunks || chunks.length === 0) return [];

  const index = new BM25Index(chunks);
  const queryTokens = tokenize(query);
  const scored = index.scoreQuery(queryTokens);

  if (scored.length === 0) return [];

  const maxRawScore = scored[0].rawScore || 1;
  const top = scored.slice(0, k);

  return top.map((item, rank) => {
    const normScore = Math.min(1, Math.max(0, item.rawScore / maxRawScore));
    return {
      id: item.doc.id,
      text: item.doc.text,
      metadata: normalizeMetadata(item.doc.metadata),
      sparseScore: parseFloat(normScore.toFixed(4)),
      rawBm25Score: parseFloat(item.rawScore.toFixed(4)),
      sparseRank: rank + 1,
    };
  });
}

module.exports = {
  retrieveSparse,
  BM25Index,
  tokenize,
};

