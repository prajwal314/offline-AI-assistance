/**
 * Coverage assessment (Change 4, step 2).
 * For a candidate set, determines which sub-requirements each chunk covers.
 * Method is configurable (opts.method):
 *  - 'lexical' (default): fraction of requirement content tokens present in
 *    the chunk (recall-oriented). Zero deps, fully offline.
 *  - 'embedding': cosine similarity via local Ollama embeddings (opts.embedFn,
 *    defaults to embeddingService.generateEmbeddings).
 *  - 'llm': pairwise judge via Ollama (opts.judgeFn). Most expensive.
 */

const COVERAGE_THRESHOLD = Number(process.env.EVIDENCE_COVERAGE_THRESHOLD) || 0.35;
const EMBEDDING_COVERAGE_THRESHOLD = 0.72;

const COVERAGE_STOPWORDS = new Set(
  "a,an,the,and,or,but,of,to,in,on,for,with,what,when,where,which,who,how,is,are,was,were,be,been,by,from,that,this,these,those,it,its,as,at,do,does,did,have,has,had,please,tell,me,give,show,list,and,also,well,between,into,over,under,each".split(",")
);

function contentTokens(text) {
  const toks = String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
  return toks.filter((t) => t.length > 1 && !COVERAGE_STOPWORDS.has(t));
}

function lexicalCoverScore(reqText, chunkText) {
  const req = [...new Set(contentTokens(reqText))];
  if (req.length === 0) return 0;
  const chunkSet = new Set(contentTokens(chunkText));
  let hit = 0;
  for (const t of req) if (chunkSet.has(t)) hit++;
  return hit / req.length;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embeddingCoverScores(requirements, candidates, embedFn) {
  const { generateEmbeddings } = require("../services/embeddingService");
  const embed = embedFn || generateEmbeddings;
  const texts = [...requirements.map((r) => r.text), ...candidates.map((c) => c.text || "")];
  const vecs = await embed(texts);
  const reqVecs = vecs.slice(0, requirements.length);
  const chunkVecs = vecs.slice(requirements.length);
  return candidates.map((_, ci) =>
    requirements.map((_, ri) => cosine(reqVecs[ri], chunkVecs[ci]))
  );
}

async function llmCoverScores(requirements, candidates, judgeFn) {
  const scores = [];
  for (const c of candidates) {
    const row = [];
    for (const r of requirements) {
      try {
        const res = await judgeFn(r.text, c.text || "");
        row.push(typeof res === "number" ? res : res?.score ?? (res?.covers ? 1 : 0));
      } catch {
        row.push(0);
      }
    }
    scores.push(row);
  }
  return scores;
}

function thresholdFor(method) {
  if (method === "embedding") return EMBEDDING_COVERAGE_THRESHOLD;
  return COVERAGE_THRESHOLD;
}

/**
 * assessCoverage(requirements, candidates, opts)
 * -> { perRequirement: [{requirementId, text, coveredBy: [chunkIds], bestScore}],
 *      chunkCovers: { chunkId: [{requirementId, score}] },
 *      coverageRatio, uncovered: [requirementIds], method, threshold }
 */
async function assessCoverage(requirements, candidates, opts = {}) {
  const reqs = Array.isArray(requirements) ? requirements : [];
  const cands = Array.isArray(candidates) ? candidates : [];
  const method = ["lexical", "embedding", "llm"].includes(opts.method) ? opts.method : "lexical";
  const threshold = opts.threshold ?? thresholdFor(method);

  let matrix;
  if (reqs.length === 0 || cands.length === 0) {
    matrix = cands.map(() => reqs.map(() => 0));
  } else if (method === "embedding") {
    matrix = await embeddingCoverScores(reqs, cands, opts.embedFn);
  } else if (method === "llm") {
    if (typeof opts.judgeFn !== "function") throw new Error("coverage method 'llm' requires opts.judgeFn");
    matrix = await llmCoverScores(reqs, cands, opts.judgeFn);
  } else {
    matrix = cands.map((c) => reqs.map((r) => lexicalCoverScore(r.text, c.text)));
  }

  const chunkIdOf = (c, i) => String(c.chunkId ?? c.id ?? `c${i}`);
  const chunkCovers = {};
  cands.forEach((c, ci) => {
    chunkCovers[chunkIdOf(c, ci)] = reqs
      .map((r, ri) => ({ requirementId: r.id, score: round3(matrix[ci][ri]) }))
      .filter((e) => e.score >= threshold);
  });

  const perRequirement = reqs.map((r, ri) => {
    const covering = [];
    cands.forEach((c, ci) => {
      if (matrix[ci][ri] >= threshold) covering.push({ chunkId: chunkIdOf(c, ci), score: round3(matrix[ci][ri]) });
    });
    covering.sort((a, b) => b.score - a.score);
    return {
      requirementId: r.id,
      text: r.text,
      coveredBy: covering.map((x) => x.chunkId),
      bestScore: covering.length > 0 ? covering[0].score : 0,
      covered: covering.length > 0,
    };
  });

  const coveredCount = perRequirement.filter((p) => p.covered).length;
  return {
    perRequirement,
    chunkCovers,
    coverageRatio: reqs.length === 0 ? 1 : coveredCount / reqs.length,
    uncovered: perRequirement.filter((p) => !p.covered).map((p) => p.requirementId),
    method,
    threshold,
  };
}

function round3(n) {
  return parseFloat(Number(n).toFixed(3));
}

module.exports = {
  assessCoverage,
  lexicalCoverScore,
  contentTokens,
  cosine,
  COVERAGE_THRESHOLD,
};
