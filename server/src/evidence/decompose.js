/**
 * Question decomposition (Change 4, step 1).
 * Splits a multi-part question into sub-requirements using the local Ollama
 * model with a strict JSON output format. Any failure (timeout, bad JSON,
 * empty result) falls back to treating the whole question as one requirement.
 */

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";
const DECOMP_TIMEOUT_MS = Number(process.env.EVIDENCE_DECOMP_TIMEOUT_MS) || 15000;
const MAX_REQUIREMENTS = 6;

const DECOMP_PROMPT = `Split the following user question into independent sub-requirements needed to answer it fully.
Rules:
- Each sub-requirement must be a short standalone question or statement.
- Do not answer the question. Do not add facts.
- If the question has only one part, return exactly one sub-requirement.
- Respond with ONLY a JSON array of strings, e.g. ["...", "..."]. No other text.

QUESTION:
`;

function cleanRequirements(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const t = item.trim().replace(/^["'`\-\*\d\.\)\s]+/, "").replace(/["'`\s]+$/, "").trim();
    if (t.length < 3 || t.length > 500) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= MAX_REQUIREMENTS) break;
  }
  return out;
}

function extractJsonArray(text) {
  if (!text || typeof text !== "string") return null;
  const stripped = text.replace(/```json|```/g, "").trim();
  try {
    const direct = JSON.parse(stripped);
    if (Array.isArray(direct)) return direct;
  } catch {}
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return null;
}

function looksSingle(question) {
  const q = String(question || "").trim();
  if (q.length < 120 && !/[?;]/.test(q.slice(0, -1)) && !/\band\b|\balso\b|\bas well as\b|,/i.test(q)) return true;
  return false;
}

async function callOllama(question, fetchFn) {
  const doFetch = fetchFn || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DECOMP_TIMEOUT_MS);
  try {
    const res = await doFetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt: DECOMP_PROMPT + question,
        stream: false,
        think: false,
        options: { temperature: 0, num_predict: 300 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Ollama generate failed: ${res.status}`);
    const data = await res.json();
    return data.response || "";
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * decomposeQuestion(question, opts) -> { requirements: [{id, text}], method, latencyMs }
 * method: 'llm' | 'single' (trivially one part, no LLM call) | 'fallback' (parse failure)
 * opts: { fetchFn } (DI for tests)
 */
async function decomposeQuestion(question, opts = {}) {
  const t0 = Date.now();
  const q = String(question || "").trim();
  if (!q) return { requirements: [], method: "fallback", latencyMs: Date.now() - t0 };
  if (looksSingle(q)) {
    return { requirements: [{ id: "r1", text: q }], method: "single", latencyMs: Date.now() - t0 };
  }
  try {
    const raw = await callOllama(q, opts.fetchFn);
    const reqs = cleanRequirements(extractJsonArray(raw));
    if (reqs.length === 0) throw new Error("no usable sub-requirements parsed");
    return {
      requirements: reqs.map((text, i) => ({ id: `r${i + 1}`, text })),
      method: "llm",
      latencyMs: Date.now() - t0,
    };
  } catch (err) {
    return {
      requirements: [{ id: "r1", text: q }],
      method: "fallback",
      latencyMs: Date.now() - t0,
      fallbackReason: String(err.message || err).slice(0, 200),
    };
  }
}

module.exports = {
  decomposeQuestion,
  cleanRequirements,
  extractJsonArray,
  DECOMP_TIMEOUT_MS,
  MAX_REQUIREMENTS,
};
