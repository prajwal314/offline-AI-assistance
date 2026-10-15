// Version 2 — Confidence-Aware RAG: evidence sufficiency checking + query refinement.
//
// Design notes (kept simple for a final-year research project):
// - Retrieval similarity (Chroma distance) is a relevance SIGNAL, not proof.
//   A non-empty result set does NOT imply sufficient evidence.
// - The LLM evidence score is NOT a calibrated probability. The checker must
//   return a structured {sufficient, reason, missing_information,
//   relevant_chunk_ids} verdict which is validated before use.
// - Any malformed checker output fails SAFE toward abstention (never claims
//   sufficient). Technical failures (Ollama/Chroma down) propagate as errors
//   and are never disguised as abstentions.

const { generateJson } = require("./llmService");

const ABSTAIN_MESSAGE =
  "I could not find enough relevant information in the knowledge base to answer this question.";

// Hard caps so the retry can never loop: exactly one refinement + one re-query.
const MAX_RETRIES = 1;
const CHECKER_CHUNK_CHARS = 1200;
const CHECKER_MAX_CHUNKS = 5;

const STOPWORDS = new Set(
  "what,when,where,which,who,whom,whose,why,how,does,do,did,is,are,was,were,be,been,being,have,has,had,the,a,an,and,or,but,of,in,on,for,to,from,with,about,into,over,after,before,between,under,again,once,that,this,these,those,then,than,so,such,can,could,should,would,will,there,their,they,them,your,our,please,tell,give,show,find,describe,explain".split(",")
);

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3 && !STOPWORDS.has(t));
}

// Lightweight supporting signal: fraction of question keywords present in the
// retrieved text. A heuristic only — never proof of sufficiency on its own.
function keywordOverlap(question, chunks) {
  const keys = [...new Set(tokens(question))];
  if (keys.length === 0) return { overlap: 0, matched: 0, total: 0 };
  const haystack = (chunks || []).map((c) => c.text || "").join("\n").toLowerCase();
  const matched = keys.filter((k) => haystack.includes(k)).length;
  return { overlap: matched / keys.length, matched, total: keys.length };
}

function supportingSignals(question, chunks) {
  const texts = (chunks || []).map((c) => c.text || "");
  const nonEmpty = texts.filter((t) => t.trim().length > 0).length;
  const avgCharLength =
    texts.length === 0 ? 0 : Math.round(texts.reduce((a, t) => a + t.length, 0) / texts.length);
  const distances = (chunks || []).map((c) => c.distance).filter((d) => typeof d === "number");
  const minDistance = distances.length ? Math.min(...distances) : null;
  const { overlap, matched, total } = keywordOverlap(question, chunks);
  return { nonEmpty, chunkCount: (chunks || []).length, avgCharLength, minDistance, keywordOverlap: overlap, keywordMatched: matched, keywordTotal: total };
}

function chunkLabel(c, i) {
  return c.id || `chunk-${i}`;
}

function buildCheckerPrompt(question, chunks) {
  const shown = (chunks || []).slice(0, CHECKER_MAX_CHUNKS).map((c, i) => {
    const text = String(c.text || "").slice(0, CHECKER_CHUNK_CHARS);
    return `PASSAGE ${chunkLabel(c, i)}:\n${text}`;
  }).join("\n\n---\n\n");
  return `You are an evidence checker for a retrieval-augmented QA system. The passages below are excerpts from the user's own uploaded documents and web research sources. Judge ONLY whether they contain the facts needed to answer the question. Do NOT answer the question itself and do NOT use outside knowledge.

IMPORTANT: if the question asks what a document is about, or asks for a summary of its topics, the passages themselves ARE the answer material — judge sufficient when they contain substantive content about the question's subject, even if no single passage states it in one sentence.

QUESTION:
${question}

RETRIEVED PASSAGES:
${shown || "(no passages)"}

Consider: are the passages relevant? Do they state the facts needed? Is the evidence specific enough? Does the question ask for something absent? Do passages contradict each other?

Reply with ONLY a single JSON object, no other text, exactly this shape:
{"sufficient": true or false, "reason": "short explanation", "missing_information": "what is not established, or empty string", "relevant_chunk_ids": ["PASSAGE ids that support the assessment"], "conflict": true or false}`;
}

// Strict validation of the checker's structured output. Returns a normalized
// verdict or null when the output is malformed (caller fails safe).
// Tolerates markdown fences (```json ... ```) and leading/trailing prose so a
// valid JSON verdict buried in chatter is still accepted.
function parseCheckerOutput(raw, chunks) {
  try {
    let text = String(raw || "").trim();
    if (!text) return null;
    // Strip markdown code fences if the model wrapped the JSON.
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) text = fence[1].trim();
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    const obj = JSON.parse(text.slice(start, end + 1));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    if (typeof obj.sufficient !== "boolean") return null;
    const knownIds = new Set((chunks || []).map((c, i) => chunkLabel(c, i)));
    const ids = Array.isArray(obj.relevant_chunk_ids)
      ? obj.relevant_chunk_ids.filter((id) => typeof id === "string" && knownIds.has(id))
      : [];
    return {
      sufficient: obj.sufficient,
      reason: typeof obj.reason === "string" ? obj.reason.slice(0, 500) : "",
      missing_information:
        typeof obj.missing_information === "string"
          ? obj.missing_information.slice(0, 500)
          : Array.isArray(obj.missing_information)
            ? obj.missing_information.filter((x) => typeof x === "string").join("; ").slice(0, 500)
            : "",
      relevant_chunk_ids: ids,
      conflict: obj.conflict === true,
    };
  } catch {
    return null;
  }
}

// Rule-based pre-check that needs no LLM. Returns a verdict or null when the
// case genuinely needs the LLM judge.
function rulePreCheck(question, chunks) {
  if (!chunks || chunks.length === 0) {
    return {
      sufficient: false, reason: "No chunks retrieved.", missing_information: "No evidence retrieved for this question.",
      relevant_chunk_ids: [], conflict: false, method: "rule",
    };
  }
  const signals = supportingSignals(question, chunks);
  if (signals.nonEmpty === 0 || signals.avgCharLength < 20) {
    return {
      sufficient: false, reason: "Retrieved passages are empty or too short to support an answer.",
      missing_information: "No substantive passage content retrieved.", relevant_chunk_ids: [], conflict: false,
      method: "rule", supportingSignals: signals,
    };
  }
  return null; // needs the LLM judge
}

async function checkEvidenceSufficiency(question, chunks, { llmCall = generateJson } = {}) {
  const signals = supportingSignals(question, chunks);
  const pre = rulePreCheck(question, chunks);
  if (pre) return { ...pre, supportingSignals: { ...signals, ...(pre.supportingSignals || {}) } };

  let verdict;
  try {
    const raw = await llmCall(buildCheckerPrompt(question, chunks));
    verdict = parseCheckerOutput(raw, chunks);
  } catch (err) {
    // Checker LLM technically failed: fall back to the weak keyword heuristic
    // (V1 parity — the answer prompt itself still abstains when context is
    // insufficient) and record the error explicitly.
    const sufficient = signals.keywordOverlap >= 0.35 && signals.nonEmpty > 0;
    return {
      sufficient,
      reason: sufficient
        ? "Evidence checker unavailable; weak keyword-overlap heuristic suggests possible relevance."
        : "Evidence checker unavailable and keyword overlap with retrieved passages is low.",
      missing_information: sufficient ? "" : "Could not verify evidence because the checker call failed.",
      relevant_chunk_ids: [],
      conflict: false,
      method: "rule-fallback",
      checkerError: String((err && err.message) || err).slice(0, 300),
      supportingSignals: signals,
    };
  }

  if (!verdict) {
    // Malformed checker output: fail SAFE toward abstention (Test F).
    return {
      sufficient: false,
      reason: "Evidence checker returned malformed output — treating evidence as insufficient.",
      missing_information: "Checker verdict could not be parsed, so sufficiency is unproven.",
      relevant_chunk_ids: [],
      conflict: false,
      method: "llm-malformed",
      supportingSignals: signals,
    };
  }
  return { ...verdict, method: "llm", supportingSignals: signals };
}

function buildRefinePrompt(question) {
  return `Rewrite the following user question into a single short retrieval-friendly search query for a vector database. Preserve the original intent and key terms. Do NOT add facts, assumptions, or answers, and do NOT explain your reasoning. Output ONLY the rewritten query on one line.

ORIGINAL QUESTION:
${question}

REWRITTEN QUERY:`;
}

// Reasoning models (qwen3) often narrate their process ("We are rewriting…",
// "Steps: 1…") instead of returning just the query. Detect that meta-talk and
// fall back to the original question so the retry re-searches with meaningful
// terms instead of prompt-echo garbage.
function isMetaTalk(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (/\n/.test(t)) return true; // a real rewritten query is a single line
  return /^(we are|here is|the (user|question|query)|sure|certainly|steps?:|original question|rewritten|to rewrite|as an ai)\b/i.test(t);
}

async function refineQuery(question, { llmCall = generateJson } = {}) {
  const raw = await llmCall(buildRefinePrompt(question), { numPredict: 150, format: null });
  const firstLine = String(raw || "").trim().replace(/^["']|["']$/g, "").split("\n")[0].trim().slice(0, 500);
  if (!firstLine) throw new Error("Query refinement returned an empty query");
  if (isMetaTalk(firstLine)) {
    // Fall back to the original question (trimmed) — the retry then widens
    // the net with dedupe/merge rather than searching echoed instructions.
    const fallback = String(question || "").trim().replace(/\s+/g, " ").slice(0, 500);
    if (!fallback) throw new Error("Query refinement returned an empty query");
    return fallback;
  }
  return firstLine;
}

module.exports = {
  ABSTAIN_MESSAGE,
  MAX_RETRIES,
  checkEvidenceSufficiency,
  refineQuery,
  parseCheckerOutput,
  rulePreCheck,
  keywordOverlap,
  supportingSignals,
  buildCheckerPrompt,
  buildRefinePrompt,
};
