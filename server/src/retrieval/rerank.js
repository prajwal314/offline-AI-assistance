/**
 * Rerank stage (Change: optional reranking).
 *
 *   const { rerank } = require("./rerank");
 *   const { results, latencyMs, backend, fallback } =
 *     await rerank(query, hybridCandidates, { topK: 5 });
 *
 * Backends:
 *  - "lexical" (default): local cross-relevance scorer (unigram/bigram/proximity
 *    over the existing zero-dependency scorer in ./reranker). Always available,
 *    fully offline, deterministic. No model download, no service.
 *  - "cross-encoder": local cross-encoder via transformers.js
 *    (default model Xenova/ms-marco-MiniLM-L-6-v2, override with RERANK_MODEL).
 *    The package is an OPTIONAL lazy dependency: it is required only when this
 *    backend is selected. First use downloads the model once (network needed
 *    that one time); afterwards it runs fully offline.
 *  - "auto": try cross-encoder, fall back to lexical on any failure.
 *
 * Failure contract: if the cross-encoder package/model is missing or inference
 * fails, we log a warning and return candidates in their original (hybrid)
 * order sliced to topK, with `fallback: true`. Rerank latency is always
 * recorded so evaluation can report it.
 */

const { scoreRelevance } = require("./reranker");

const DEFAULT_RERANK_MODEL =
  process.env.RERANK_MODEL || "Xenova/ms-marco-MiniLM-L-6-v2";
const DEFAULT_BACKEND = (process.env.RERANK_BACKEND || "lexical").toLowerCase();
const VALID_BACKENDS = ["lexical", "cross-encoder", "auto"];

// Cached cross-encoder artifacts (lazy, one model at a time).
let cachedEncoder = null; // { modelName, tokenizer, model } | null
let cachedEncoderFailed = null; // modelName that failed to load (avoid retry spam)

function resolveBackend(requested) {
  const b = String(requested || DEFAULT_BACKEND).toLowerCase();
  return VALID_BACKENDS.includes(b) ? b : "lexical";
}

function baseScoreOf(cand) {
  const s = cand.score ?? cand.rrfScore ?? cand.hybridScore ?? cand.denseScore;
  return typeof s === "number" ? s : 0.5;
}

function lexicalRerank(query, candidates) {
  return candidates.map((cand) => {
    const lexicalScore = scoreRelevance(query, cand.text);
    const base = baseScoreOf(cand);
    return {
      ...cand,
      lexicalScore,
      crossScore: lexicalScore,
      rerankScore: parseFloat((0.55 * lexicalScore + 0.45 * base).toFixed(4)),
    };
  });
}

async function loadCrossEncoder(modelName) {
  if (cachedEncoder && cachedEncoder.modelName === modelName) return cachedEncoder;
  if (cachedEncoderFailed === modelName) {
    throw new Error(`cross-encoder model "${modelName}" failed to load previously; skipping retry`);
  }
  let transformers;
  try {
    transformers = require("@xenova/transformers");
  } catch (e) {
    throw new Error(
      'cross-encoder backend needs the optional "@xenova/transformers" package (npm i @xenova/transformers)'
    );
  }
  const { AutoTokenizer, AutoModelForSequenceClassification } = transformers;
  if (!AutoTokenizer || !AutoModelForSequenceClassification) {
    throw new Error('installed "@xenova/transformers" does not expose AutoTokenizer/AutoModelForSequenceClassification');
  }
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(modelName);
    const model = await AutoModelForSequenceClassification.from_pretrained(modelName, {
      quantized: true,
    });
    cachedEncoder = { modelName, tokenizer, model };
    return cachedEncoder;
  } catch (e) {
    cachedEncoderFailed = modelName;
    throw new Error(`could not load cross-encoder model "${modelName}": ${e.message}`);
  }
}

/** For tests / ops: clear the cached model so the next call reloads. */
function resetRerankCache() {
  cachedEncoder = null;
  cachedEncoderFailed = null;
}

async function scoreWithCrossEncoder(query, candidates, modelName) {
  const { tokenizer, model } = await loadCrossEncoder(modelName);
  const scores = [];
  for (const cand of candidates) {
    const inputs = await tokenizer(query, cand.text || "", {
      truncation: true,
      max_length: 512,
    });
    const output = await model(inputs);
    const logit = output.logits.data[0];
    scores.push(typeof logit === "number" ? logit : 0);
  }
  return scores;
}

function sortByRerank(scored, topK) {
  const k = Math.max(1, parseInt(topK, 10) || scored.length || 5);
  const sorted = [...scored].sort((a, b) => b.rerankScore - a.rerankScore);
  return sorted.slice(0, k).map((item, idx) => ({ ...item, rerankRank: idx + 1 }));
}

function fallbackResult(candidates, topK, latencyMs, reason) {
  const k = Math.max(1, parseInt(topK, 10) || candidates.length || 5);
  return {
    results: candidates.slice(0, k).map((cand, idx) => ({
      ...cand,
      rerankScore: null,
      rerankRank: idx + 1,
    })),
    latencyMs,
    backend: "none",
    fallback: true,
    fallbackReason: reason,
  };
}

/**
 * Rerank candidates. Never throws for backend problems: on failure it warns
 * and returns the input (hybrid) order.
 *
 * opts: { topK, backend, model, crossEncoderFn }
 *  - crossEncoderFn(query, candidates) -> Promise<number[]> is a DI hook for
 *    tests; it replaces the transformers.js call but is still failure-guarded.
 */
async function rerank(query, candidates = [], opts = {}) {
  const t0 = Date.now();
  const list = Array.isArray(candidates) ? candidates : [];
  const topK = Math.max(1, parseInt(opts.topK, 10) || list.length || 5);
  const backend = resolveBackend(opts.backend);
  const modelName = opts.model || DEFAULT_RERANK_MODEL;

  if (list.length === 0) {
    return { results: [], latencyMs: Date.now() - t0, backend, fallback: false };
  }

  if (backend === "lexical") {
    const results = sortByRerank(lexicalRerank(query, list), topK);
    return { results, latencyMs: Date.now() - t0, backend, fallback: false };
  }

  // "cross-encoder" or "auto": try the model first.
  try {
    const scores = opts.crossEncoderFn
      ? await opts.crossEncoderFn(query, list)
      : await scoreWithCrossEncoder(query, list, modelName);
    if (!Array.isArray(scores) || scores.length !== list.length) {
      throw new Error(`cross-encoder returned ${scores?.length ?? "?"} scores for ${list.length} candidates`);
    }
    const scored = list.map((cand, i) => ({
      ...cand,
      crossEncoderScore: scores[i],
      rerankScore: scores[i],
    }));
    const results = sortByRerank(scored, topK);
    return { results, latencyMs: Date.now() - t0, backend: "cross-encoder", fallback: false };
  } catch (err) {
    const reason = err.message || String(err);
    if (backend === "auto") {
      console.warn(`[rerank] cross-encoder unavailable (${reason}); using lexical rerank`);
      const results = sortByRerank(lexicalRerank(query, list), topK);
      return {
        results,
        latencyMs: Date.now() - t0,
        backend: "lexical",
        fallback: true,
        fallbackReason: reason,
      };
    }
    console.warn(`[rerank] cross-encoder failed (${reason}); falling back to hybrid order`);
    return fallbackResult(list, topK, Date.now() - t0, reason);
  }
}

module.exports = {
  rerank,
  resolveBackend,
  resetRerankCache,
  lexicalRerank,
  DEFAULT_RERANK_MODEL,
  DEFAULT_BACKEND,
  VALID_BACKENDS,
};
