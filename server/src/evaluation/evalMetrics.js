/**
 * Change-5 evaluation metrics (per-question, ID-based).
 * Existing metrics.js is untouched; these operate on required_evidence_ids.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";
const JUDGE_TIMEOUT_MS = Number(process.env.EVAL_JUDGE_TIMEOUT_MS) || 20000;

function idsOf(selected) {
  return (selected || []).map((c, i) => String(c?.chunkId ?? c?.id ?? `c${i}`));
}

function round4(n) {
  return parseFloat(Number(n).toFixed(4));
}

function precisionAtK(selected, requiredIds, k) {
  const top = idsOf(selected).slice(0, k);
  if (top.length === 0) return 0;
  const req = new Set(requiredIds);
  return top.filter((id) => req.has(id)).length / top.length;
}

function recallAtK(selected, requiredIds, k) {
  if (!requiredIds || requiredIds.length === 0) return 1;
  const top = new Set(idsOf(selected).slice(0, k));
  const hit = requiredIds.filter((id) => top.has(String(id))).length;
  return Math.min(1, hit / requiredIds.length);
}

function reciprocalRank(selected, requiredIds) {
  const req = new Set((requiredIds || []).map(String));
  const ids = idsOf(selected);
  for (let i = 0; i < ids.length; i++) {
    if (req.has(ids[i])) return 1 / (i + 1);
  }
  return 0;
}

function ndcgAtK(selected, requiredIds, k) {
  const req = new Set((requiredIds || []).map(String));
  const top = idsOf(selected).slice(0, k);
  if (top.length === 0 || req.size === 0) return req.size === 0 ? 1 : 0;
  let dcg = 0;
  top.forEach((id, idx) => {
    if (req.has(id)) dcg += 1 / Math.log2(idx + 2);
  });
  let idcg = 0;
  for (let i = 0; i < Math.min(req.size, top.length); i++) idcg += 1 / Math.log2(i + 2);
  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Evidence coverage: FULL credit (1) only if ALL required evidence ids were
 * retrieved, else 0. Binary by design.
 */
function evidenceCoverage(selected, requiredIds) {
  if (!requiredIds || requiredIds.length === 0) return 1;
  const retrieved = new Set(idsOf(selected));
  return requiredIds.every((id) => retrieved.has(String(id))) ? 1 : 0;
}

/**
 * Redundancy rate: fraction of chunk pairs with Jaccard similarity above
 * threshold. 0 when fewer than 2 chunks. similarityFn injectable for tests.
 */
function redundancyRate(selected, opts = {}) {
  const threshold = opts.threshold ?? 0.7;
  const sim = opts.similarityFn || require("../evidence/diversityFilter").computeJaccardSimilarity;
  const n = (selected || []).length;
  if (n < 2) return 0;
  let redundant = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      total++;
      let v = 0;
      try { v = sim(selected[i].text || "", selected[j].text || ""); } catch { v = 0; }
      if (v > threshold) redundant++;
    }
  }
  return total === 0 ? 0 : round4(redundant / total);
}

/**
 * Conflict-handling correctness.
 * question: { question_type, expectedConflict ('present'|'none'|undefined),
 *             expectedPreferredChunk (chunk id or undefined) }
 * outcome: { conflictsDetected: [...], preferredChunkId }
 * Returns 1 (correct) / 0 (wrong) / null (not applicable).
 */
function conflictCorrectness(question, outcome) {
  if (!question || question.question_type !== "conflicting_evidence") return null;
  const expected = question.expectedConflict ?? question.expected_conflict ?? "present";
  const detected = Array.isArray(outcome?.conflictsDetected) && outcome.conflictsDetected.length > 0;
  if (expected === "none") return detected ? 0 : 1;
  if (!detected) return 0;
  const preferred = question.expectedPreferredChunk ?? question.expected_preferred_chunk;
  if (preferred) {
    return String(outcome.preferredChunkId) === String(preferred) ? 1 : 0;
  }
  return 1;
}

/** Approximate context size: ~4 chars per token, summed over selected chunks. */
function contextTokens(selected) {
  return (selected || []).reduce((s, c) => s + Math.ceil(String(c?.text || "").length / 4), 0);
}

// ---------------------------------------------------------------------------
// Optional Ollama judge (APPROXIMATION — labelled as such everywhere used).
// ---------------------------------------------------------------------------

async function judgeCall(prompt, fetchFn) {
  const doFetch = fetchFn || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    const res = await doFetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, think: false, options: { temperature: 0, num_predict: 200 } }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`judge failed: ${res.status}`);
    const data = await res.json();
    return data.response || "";
  } finally {
    clearTimeout(timeout);
  }
}

function parseJudgeScore(text) {
  const s = String(text || "");
  const m = s.match(/score\s*[:=]\s*(0(?:\.\d+)?|1(?:\.0+)?)/i);
  if (m) return Math.min(1, Math.max(0, Number(m[1])));
  // Verdict words only (bare "yes"/"no" appear in ordinary prose — ignore them).
  if (/\bun(supported|faithful)\b/i.test(s)) return 0;
  const sup = s.match(/\b(not|isn't|is not|no|never)\b.{0,20}\b(supported|faithful|accurate)\b/i);
  if (sup) return 0;
  if (/\b(supported|faithful|accurate)\b/i.test(s)) return 1;
  return null;
}

/**
 * Answer faithfulness (APPROXIMATION via local Ollama judge).
 * Returns { score: 0..1|null, approximation: true, note } — null when the
 * judge is unavailable or there is no answer to judge.
 */
async function judgeFaithfulness(question, answer, evidenceTexts, opts = {}) {
  if (!answer || !answer.trim()) return { score: null, approximation: true, note: "no answer to judge" };
  try {
    const prompt = `You judge whether an ANSWER is supported by the EVIDENCE. Reply "score: <0-1>" then a brief reason.\nQUESTION: ${question}\nEVIDENCE:\n${(evidenceTexts || []).join("\n---\n").slice(0, 4000)}\nANSWER: ${String(answer).slice(0, 2000)}\nReply format: score: X`;
    const raw = await judgeCall(prompt, opts.fetchFn);
    return { score: parseJudgeScore(raw), approximation: true, note: "Ollama-judge approximation", raw: String(raw).slice(0, 300) };
  } catch (err) {
    return { score: null, approximation: true, note: `judge unavailable: ${String(err.message || err).slice(0, 120)}` };
  }
}

/**
 * Citation accuracy (APPROXIMATION): checks the answer names the sources it
 * used (filenames / chunk ids present in the answer text).
 * Returns { score: 0..1|null, approximation: true, ... }.
 */
async function judgeCitations(answer, selected, opts = {}) {
  if (!answer || !answer.trim()) return { score: null, approximation: true, note: "no answer to judge" };
  if (!selected || selected.length === 0) return { score: null, approximation: true, note: "no sources selected" };
  try {
    if (typeof opts.judgeFn === "function") {
      const r = await opts.judgeFn(answer, selected);
      return { score: typeof r === "number" ? r : r?.score ?? null, approximation: true, note: "custom judge (approximation)" };
    }
    const names = [...new Set(selected.flatMap((c) => {
      const m = c?.metadata || {};
      return [m.filename, m.title, c.chunkId ?? c.id].filter(Boolean).map(String);
    }))];
    const lower = answer.toLowerCase();
    const cited = names.filter((n) => n && lower.includes(String(n).toLowerCase().slice(0, 24)));
    return { score: round4(names.length === 0 ? 0 : cited.length / names.length), approximation: true, note: "filename-mention heuristic approximation" };
  } catch (err) {
    return { score: null, approximation: true, note: `judge unavailable: ${String(err.message || err).slice(0, 120)}` };
  }
}

/**
 * Citation accuracy (APPROXIMATION): checks the answer names the sources it
 * used (filenames / chunk ids present in the answer text).
 * Returns { score: 0..1|null, approximation: true, ... }.
 */
async function judgeCitations(answer, selected, opts = {}) {
  if (!answer || !answer.trim()) return { score: null, approximation: true, note: "no answer to judge" };
  if (!selected || selected.length === 0) return { score: null, approximation: true, note: "no sources selected" };
  try {
    if (typeof opts.judgeFn === "function") {
      const r = await opts.judgeFn(answer, selected);
      return { score: typeof r === "number" ? r : r?.score ?? null, approximation: true, note: "custom judge (approximation)" };
    }
    const names = [...new Set(selected.flatMap((c) => {
      const m = c?.metadata || {};
      return [m.filename, m.title, c.chunkId ?? c.id].filter(Boolean).map(String);
    }))];
    const lower = answer.toLowerCase();
    const cited = names.filter((n) => n && lower.includes(String(n).toLowerCase().slice(0, 24)));
    return { score: round4(names.length === 0 ? 0 : cited.length / names.length), approximation: true, note: "filename-mention heuristic approximation" };
  } catch (err) {
    return { score: null, approximation: true, note: `judge unavailable: ${String(err.message || err).slice(0, 120)}` };
  }
}

// ---------------------------------------------------------------------------
// Answer correctness: token-overlap F1 + strict-JSON Ollama judge.
// The judge is an APPROXIMATION — labelled as such on every return.
// ---------------------------------------------------------------------------

function tokens(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

/** Bag-of-tokens precision/recall/F1 of answer vs expected answer. */
function tokenF1(answer, expected) {
  const a = tokens(answer);
  const e = tokens(expected);
  if (a.length === 0 || e.length === 0) return { precision: 0, recall: 0, f1: 0 };
  const counts = new Map();
  for (const t of e) counts.set(t, (counts.get(t) || 0) + 1);
  let overlap = 0;
  for (const t of a) {
    const c = counts.get(t) || 0;
    if (c > 0) { overlap++; counts.set(t, c - 1); }
  }
  const p = overlap / a.length;
  const r = overlap / e.length;
  return { precision: round4(p), recall: round4(r), f1: p + r === 0 ? 0 : round4((2 * p * r) / (p + r)) };
}

function extractJsonObject(text) {
  const s = String(text || "").replace(/```json|```/g, "");
  try {
    const direct = JSON.parse(s);
    if (direct && typeof direct === "object") return direct;
  } catch {}
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(s.slice(start, end + 1));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }
  return null;
}

/** Parse {correct: true|false|"partial", reason} — null when unparseable. */
function parseCorrectnessJson(text) {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const raw = typeof obj.correct === "string" ? obj.correct.toLowerCase() : obj.correct;
  const verdict = raw === true || raw === "true" || raw === "yes" ? true
    : raw === false || raw === "false" || raw === "no" ? false
    : raw === "partial" || raw === "partly" ? "partial"
    : null;
  if (verdict === null || verdict === undefined) return null;
  return { correct: verdict, reason: String(obj.reason || "").slice(0, 300) };
}

const CORRECTNESS_SCORE = { [true]: 1, false: 0, partial: 0.5 };

/**
 * Answer correctness via local Ollama judge (APPROXIMATION).
 * Returns { verdict: true|false|'partial'|null, score: 1|0.5|0|null,
 *           reason, approximation: true, ... }.
 */
async function judgeCorrectness(question, answer, expected, opts = {}) {
  if (!answer || !String(answer).trim()) return { verdict: null, score: null, reason: "no answer to judge", approximation: true };
  if (!expected || !String(expected).trim()) return { verdict: null, score: null, reason: "no expected answer labelled", approximation: true };
  try {
    const prompt = `You grade whether the ANSWER correctly answers the QUESTION compared to the EXPECTED answer. Reply with strict JSON only, exactly like {"correct": true, "reason": "..."} where correct is true, false, or "partial".\nQUESTION: ${String(question).slice(0, 500)}\nEXPECTED: ${String(expected).slice(0, 1000)}\nANSWER: ${String(answer).slice(0, 2000)}`;
    const raw = await judgeCall(prompt, opts.fetchFn);
    const parsed = parseCorrectnessJson(raw);
    if (!parsed) return { verdict: null, score: null, reason: "judge output unparseable", approximation: true, raw: String(raw).slice(0, 200) };
    return { verdict: parsed.correct, score: CORRECTNESS_SCORE[parsed.correct] ?? null, reason: parsed.reason, approximation: true };
  } catch (err) {
    return { verdict: null, score: null, reason: `judge unavailable: ${String(err.message || err).slice(0, 120)}`, approximation: true };
  }
}

// ---------------------------------------------------------------------------
// Groundedness (default metric): split answer into claims, judge each claim
// against the cited chunks, report supported/unsupported fractions.
// ---------------------------------------------------------------------------

const MAX_CLAIMS = 12;

function splitClaims(answer) {
  return String(answer || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((s) => tokens(s).length >= 3)
    .slice(0, 50);
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Chunk ids from [id] markers plus filename/title mentions in a sentence. */
function extractCitations(sentence, selected) {
  const found = new Set();
  const lower = String(sentence || "").toLowerCase();
  for (const c of selected || []) {
    const id = String(c?.chunkId ?? c?.id ?? "");
    if (id && new RegExp(`\\[${escapeRegExp(id)}\\]`).test(sentence)) found.add(id);
    const m = c?.metadata || {};
    for (const name of [m.filename, m.title]) {
      if (name && String(name).length >= 4 && lower.includes(String(name).toLowerCase())) found.add(id);
    }
  }
  return [...found];
}

function parseSupportJson(text) {
  const obj = extractJsonObject(text);
  if (!obj || (typeof obj.supported !== "boolean" && typeof obj.supported !== "string")) return null;
  const raw = typeof obj.supported === "string" ? obj.supported.toLowerCase() : obj.supported;
  const supported = raw === true || raw === "true" || raw === "yes";
  if (!raw && raw !== false && raw !== "false" && raw !== "no") return supported;
  return raw === false || raw === "false" || raw === "no" ? false : supported;
}

/**
 * Groundedness (APPROXIMATION via local Ollama judge, one call per claim).
 * Each claim is judged against its cited chunks (or the whole pool when the
 * sentence carries no citation). Returns per-claim verdicts plus
 * supported/unsupported fractions and citation-support accuracy
 * (fraction of cited attachments that actually support their sentence).
 */
async function judgeGroundedness(question, answer, selected, opts = {}) {
  const claims = splitClaims(answer).slice(0, MAX_CLAIMS);
  if (claims.length === 0) {
    return { claims: [], supported_pct: null, unsupported_pct: null, citation_accuracy: null, approximation: true, note: "no claims to judge" };
  }
  if (!selected || selected.length === 0) {
    return { claims: [], supported_pct: null, unsupported_pct: null, citation_accuracy: null, approximation: true, note: "no sources selected" };
  }
  const byId = new Map((selected || []).map((c) => [String(c?.chunkId ?? c?.id ?? ""), c]));
  const out = [];
  try {
    for (const claim of claims) {
      const cited = extractCitations(claim, selected);
      const pool = cited.length > 0 ? cited.map((id) => byId.get(id)).filter(Boolean) : selected;
      let supported = null;
      let reason = "";
      try {
        if (typeof opts.judgeFn === "function") {
          const r = await opts.judgeFn(claim, pool.map((c) => c.text || ""));
          supported = typeof r === "boolean" ? r : r?.supported ?? null;
          reason = String(r?.reason || "").slice(0, 200);
        } else {
          const prompt = `You check whether the CLAIM is supported by the EVIDENCE chunks. Reply with strict JSON only, exactly like {"supported": true, "reason": "..."}.\nQUESTION: ${String(question).slice(0, 300)}\nEVIDENCE:\n${pool.map((c) => c.text || "").join("\n---\n").slice(0, 3000)}\nCLAIM: ${claim.slice(0, 500)}`;
          const raw = await judgeCall(prompt, opts.fetchFn);
          supported = parseSupportJson(raw);
          reason = supported === null ? `judge output unparseable: ${String(raw).slice(0, 120)}` : "";
        }
      } catch (err) {
        return { claims: out, supported_pct: null, unsupported_pct: null, citation_accuracy: null, approximation: true, note: `judge unavailable: ${String(err.message || err).slice(0, 120)}` };
      }
      out.push({ claim: claim.slice(0, 300), citations: cited, supported, reason });
    }
  } catch (err) {
    return { claims: out, supported_pct: null, unsupported_pct: null, citation_accuracy: null, approximation: true, note: `judge unavailable: ${String(err.message || err).slice(0, 120)}` };
  }
  const judged = out.filter((c) => typeof c.supported === "boolean");
  const supported = judged.filter((c) => c.supported).length;
  const cited = out.filter((c) => c.citations.length > 0 && typeof c.supported === "boolean");
  return {
    claims: out,
    supported_pct: judged.length === 0 ? null : round4(supported / judged.length),
    unsupported_pct: judged.length === 0 ? null : round4((judged.length - supported) / judged.length),
    citation_accuracy: cited.length === 0 ? null : round4(cited.filter((c) => c.supported).length / cited.length),
    approximation: true,
  };
}

// ---------------------------------------------------------------------------
// Answer consistency: N repeated runs -> answer agreement + retrieval stability.
// ---------------------------------------------------------------------------

function jaccardSets(a, b) {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter || 1);
}

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Pairwise answer agreement: embedding cosine when embedFn given, else token F1. */
async function answerAgreement(a, b, opts = {}) {
  if (typeof opts.embedFn === "function") {
    const [va, vb] = await opts.embedFn([a || "", b || ""]);
    return cosine(va, vb);
  }
  return tokenF1(a, b).f1;
}

/**
 * Run runOnce(i) -> {answer, selected} N times (default 3).
 * Returns { n, answers, agreement, stability } — nulls when <2 runs succeed.
 */
async function measureConsistency(runOnce, opts = {}) {
  const n = Math.max(1, parseInt(opts.n, 10) || 3);
  const runs = [];
  for (let i = 0; i < n; i++) {
    try {
      const r = await runOnce(i);
      runs.push({ answer: r?.answer || "", selectedIds: idsOf(r?.selected || []) });
    } catch {
      runs.push({ answer: "", selectedIds: [], error: true });
    }
  }
  const good = runs.filter((r) => !r.error);
  if (good.length < 2) return { n, answers: runs.map((r) => r.answer), agreement: null, stability: null };
  let agreeSum = 0;
  let agreePairs = 0;
  for (let i = 0; i < good.length; i++) {
    for (let j = i + 1; j < good.length; j++) {
      agreeSum += await answerAgreement(good[i].answer, good[j].answer, opts);
      agreePairs++;
    }
  }
  let stabSum = 0;
  let stabPairs = 0;
  for (let i = 0; i < good.length; i++) {
    for (let j = i + 1; j < good.length; j++) {
      stabSum += jaccardSets(good[i].selectedIds, good[j].selectedIds);
      stabPairs++;
    }
  }
  return {
    n,
    answers: runs.map((r) => r.answer),
    agreement: agreePairs === 0 ? null : round4(agreeSum / agreePairs),
    stability: stabPairs === 0 ? null : round4(stabSum / stabPairs),
  };
}

// ---------------------------------------------------------------------------
// Cross-document consistency: was a conflict detected, and did the final
// answer handle it (preferred latest/active + qualified or abstained)?
// ---------------------------------------------------------------------------

/**
 * Returns 1 (handled) / 0.5 (right chunk, unverifiable qualification) /
 * 0 (mishandled) / null (not applicable: not a conflicting-evidence question,
 * or none expected and none detected).
 */
function conflictHandled(question, outcome = {}) {
  if (!question || question.question_type !== "conflicting_evidence") return null;
  const expected = question.expectedConflict ?? question.expected_conflict ?? "present";
  const detected = Array.isArray(outcome?.conflictsDetected) && outcome.conflictsDetected.length > 0;
  if (expected === "none") return detected ? 0 : 1;
  if (!detected) return 0;
  const expectedPreferred = question.expectedPreferredChunk ?? question.expected_preferred_chunk;
  const preferredOk = !expectedPreferred || String(outcome.preferredChunkId) === String(expectedPreferred);
  if (!preferredOk) return 0;
  const verdict = outcome.verdict;
  if (verdict === "qualified" || verdict === "abstain") return 1;
  return 0.5; // right chunk, but no recorded qualification/abstention
}

// ---------------------------------------------------------------------------
// Latency breakdown reporting: mean / p50 / p95 per stage.
// ---------------------------------------------------------------------------

function percentile(vals, p) {
  const xs = vals.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (xs.length === 1) return xs[0];
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (rank - lo);
}

const LATENCY_STAGES = ["retrieval_ms", "selection_ms", "generation_ms", "latency_ms"];

function summarizeLatencies(rows) {
  const out = {};
  for (const stage of LATENCY_STAGES) {
    const vals = (rows || []).map((r) => r[stage]).filter((v) => typeof v === "number");
    out[stage] = {
      n: vals.length,
      mean: vals.length === 0 ? null : round4(vals.reduce((s, v) => s + v, 0) / vals.length),
      p50: percentile(vals, 50) === null ? null : round4(percentile(vals, 50)),
      p95: percentile(vals, 95) === null ? null : round4(percentile(vals, 95)),
    };
  }
  return out;
}

module.exports = {
  precisionAtK,
  recallAtK,
  reciprocalRank,
  ndcgAtK,
  evidenceCoverage,
  redundancyRate,
  conflictCorrectness,
  contextTokens,
  judgeFaithfulness,
  judgeCitations,
  parseJudgeScore,
  tokens,
  tokenF1,
  parseCorrectnessJson,
  judgeCorrectness,
  splitClaims,
  extractCitations,
  judgeGroundedness,
  answerAgreement,
  measureConsistency,
  conflictHandled,
  percentile,
  summarizeLatencies,
  MAX_CLAIMS,
};
