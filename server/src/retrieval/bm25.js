/**
 * BM25 retriever (Change 1).
 * Local BM25 implemented directly (no new npm dependency, works offline).
 *
 * Tokenization is deliberately non-aggressive so exact IDs, codes and names
 * match well:
 *  - case-insensitive, but no stopword removal and no minimum token length;
 *  - compound codes (e.g. "CAT-2026", "2.1", "web_3_0") are indexed both whole
 *    and split into parts, so exact and partial queries both hit.
 *
 * Sync strategy: the index is rebuilt lazily from Chroma (the source of truth)
 * and persisted to disk (server/data/bm25-index.json). Ingestion paths call
 * markDirty() so the next search rebuilds instead of serving stale results.
 */

const fs = require("fs");
const path = require("path");

const { getAllChunks } = require("../services/chromaService");

const K1 = 1.2;
const B = 0.75;

const INDEX_DIR = path.join(__dirname, "..", "..", "data");
const INDEX_PATH = path.join(INDEX_DIR, "bm25-index.json");

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  const lower = text.toLowerCase();
  // Compound-aware: keeps "cat-2026" as one token.
  const compounds = lower.match(/[a-z0-9]+(?:[._/-][a-z0-9]+)*/g) || [];
  const out = [];
  for (const c of compounds) {
    out.push(c);
    // Also index the split parts so "CAT-2026" matches "cat" / "2026" queries.
    const parts = c.split(/[._/-]+/).filter(Boolean);
    if (parts.length > 1) {
      for (const p of parts) out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// BM25 index
// ---------------------------------------------------------------------------

class BM25Index {
  constructor(docs = [], k1 = K1, b = B) {
    this.k1 = k1;
    this.b = b;
    this.docs = docs; // [{ id, text, metadata }]
    this.docCount = docs.length;
    this.docTokens = [];
    this.docLengths = [];
    this.termFreqs = []; // per-doc Map(term -> tf)
    this.avgDocLength = 0;
    this.df = new Map();
    this.idf = new Map();
    this.build();
  }

  build() {
    if (this.docCount === 0) return;
    let totalLength = 0;
    for (let i = 0; i < this.docCount; i++) {
      const tokens = tokenize(this.docs[i].text);
      this.docTokens.push(tokens);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      this.termFreqs.push(tf);
      this.docLengths.push(tokens.length);
      totalLength += tokens.length;
      for (const term of new Set(tokens)) {
        this.df.set(term, (this.df.get(term) || 0) + 1);
      }
    }
    this.avgDocLength = totalLength / this.docCount;
    for (const [term, freq] of this.df.entries()) {
      const idfVal = Math.log(1 + (this.docCount - freq + 0.5) / (freq + 0.5));
      this.idf.set(term, Math.max(0.01, idfVal));
    }
  }

  scoreQuery(queryTokens) {
    if (this.docCount === 0 || !queryTokens || queryTokens.length === 0) return [];
    const scores = new Array(this.docCount).fill(0);
    for (const qTerm of queryTokens) {
      const idf = this.idf.get(qTerm);
      if (idf == null) continue;
      for (let i = 0; i < this.docCount; i++) {
        const tf = this.termFreqs[i].get(qTerm) || 0;
        if (tf === 0) continue;
        const docLen = this.docLengths[i] || 1;
        const numerator = tf * (this.k1 + 1);
        const denominator =
          tf + this.k1 * (1 - this.b + (this.b * docLen) / (this.avgDocLength || 1));
        scores[i] += idf * (numerator / denominator);
      }
    }
    const results = [];
    for (let i = 0; i < this.docCount; i++) {
      if (scores[i] > 0) results.push({ doc: this.docs[i], rawScore: scores[i] });
    }
    results.sort((a, b) => b.rawScore - a.rawScore);
    return results;
  }

  toJSON() {
    return {
      k1: this.k1,
      b: this.b,
      docs: this.docs,
      avgDocLength: this.avgDocLength,
    };
  }

  static fromJSON(data) {
    const idx = new BM25Index(data.docs || [], data.k1 || K1, data.b || B);
    return idx;
  }
}

// ---------------------------------------------------------------------------
// Persistence + sync
// ---------------------------------------------------------------------------

let cachedIndex = null;
let cachedChunkCount = -1;
let dirty = false;

function saveIndex(index) {
  try {
    if (!fs.existsSync(INDEX_DIR)) fs.mkdirSync(INDEX_DIR, { recursive: true });
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index.toJSON()));
  } catch (e) {
    // Persistence is best-effort; in-memory index still works.
  }
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    if (!raw || !Array.isArray(raw.docs)) return null;
    return BM25Index.fromJSON(raw);
  } catch (e) {
    return null;
  }
}

/** Mark the index stale. Called by ingestion/deletion paths (fire-and-forget). */
function markDirty() {
  dirty = true;
  cachedIndex = null;
  cachedChunkCount = -1;
}

/** Rebuild the index from Chroma and persist it. Returns the fresh index. */
async function rebuildIndex() {
  const chunks = await getAllChunks(null, 5000);
  cachedIndex = new BM25Index(
    chunks.map((c) => ({ id: c.id, text: c.text || "", metadata: c.metadata || {} }))
  );
  cachedChunkCount = chunks.length;
  dirty = false;
  saveIndex(cachedIndex);
  return cachedIndex;
}

async function getIndex() {
  if (cachedIndex && !dirty) return cachedIndex;
  // Try disk first for speed; validate by rebuilding if Chroma drifted.
  if (!cachedIndex && !dirty) {
    const fromDisk = loadIndex();
    if (fromDisk) {
      cachedIndex = fromDisk;
      cachedChunkCount = fromDisk.docCount;
      // Validate freshness against live count (cheap) — rebuild if drifted.
      try {
        const live = await getAllChunks(null, 1);
        void live;
        // getAllChunks(limit=1) doesn't give total; fall through to count check
        // via full fetch only when a search actually runs (see searchBm25).
      } catch (e) {
        /* fall through to rebuild on search */
      }
      return cachedIndex;
    }
  }
  return rebuildIndex();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

async function searchBm25(query, topK = 5, where = null) {
  if (!query || typeof query !== "string" || query.trim().length === 0) return [];
  const k = Math.max(1, parseInt(topK, 10) || 5);
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];

  let docs;
  if (where && typeof where === "object" && Object.keys(where).length > 0) {
    // Filtered search: build an ephemeral index over the filtered subset so
    // `where` semantics stay exact. The persisted full-corpus index is untouched.
    const chunks = await getAllChunks(where, 5000);
    if (!chunks || chunks.length === 0) return [];
    const index = new BM25Index(
      chunks.map((c) => ({ id: c.id, text: c.text || "", metadata: c.metadata || {} }))
    );
    return formatResults(index.scoreQuery(queryTokens).slice(0, k));
  }

  // Unfiltered: use cached/persisted index, rebuilding when stale.
  let index = await getIndex();
  // Freshness check: rebuild if Chroma gained/lost chunks since index build.
  try {
    const liveCount = (await getAllChunks(null, 5000)).length;
    if (liveCount !== cachedChunkCount) {
      index = await rebuildIndex();
    }
  } catch (e) {
    // If Chroma is unreachable here, fall back to whatever index we have.
  }
  const scored = index.scoreQuery(queryTokens).slice(0, k);
  return formatResults(scored);
}

function formatResults(scored) {
  if (!scored || scored.length === 0) return [];
  const maxRaw = scored[0].rawScore || 1;
  return scored.map((item, i) => {
    const score = Math.min(1, Math.max(0, item.rawScore / maxRaw));
    return {
      chunkId: item.doc.id,
      // Alias for interop with legacy callers that expect `id`.
      id: item.doc.id,
      text: item.doc.text,
      score: parseFloat(score.toFixed(4)),
      rank: i + 1,
      metadata: item.doc.metadata || {},
      // Preserved for later stages (fusion keeps these).
      rawBm25Score: parseFloat(item.rawScore.toFixed(4)),
      bm25Score: parseFloat(score.toFixed(4)),
      bm25Rank: i + 1,
      sparseScore: parseFloat(score.toFixed(4)),
      sparseRank: i + 1,
    };
  });
}

module.exports = {
  tokenize,
  BM25Index,
  searchBm25,
  rebuildIndex,
  markDirty,
  getIndex,
  formatResults,
  INDEX_PATH,
  K1,
  B,
};
