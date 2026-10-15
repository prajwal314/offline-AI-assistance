const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";
// Answer model is independently configurable; falls back to LLM_MODEL.
const ANSWER_MODEL = process.env.ANSWER_MODEL || process.env.LLM_MODEL || "qwen3:4b";
// Raised default so long answers are not cut off; override via env.
const NUM_PREDICT = Math.max(1, parseInt(process.env.LLM_NUM_PREDICT || "2048", 10) || 2048);

const SYSTEM_PROMPT = `You are a RAG assistant. Follow these rules strictly:
1. Answer ONLY using the supplied CONTEXT.
2. Do NOT invent facts not in CONTEXT.
3. If CONTEXT is insufficient, say: "I could not find enough relevant information in the knowledge base to answer this question."
4. Distinguish [DOCUMENT] vs [WEB] sources when citing.
5. Give a thorough, informative answer the user will find satisfying: start with a direct answer, then explain the key points with relevant details and examples from CONTEXT. Use short paragraphs or bullet points for readability. Aim for a complete explanation, not a one-line reply.
6. If sources disagree, state the disagreement explicitly.
7. Base every factual claim on CONTEXT; do not add outside facts. Mention the relevant source filename or URL when possible.`;

function formatContext(chunks) {
  if (!chunks || chunks.length === 0) return "";
  return chunks.map((c) => { 
    const m = c.metadata || {};
    if (m.sourceType === "web") {
      return `[WEB]\nTitle: ${m.title || "Web"}\nURL: ${m.url || ""}\nTopic: ${m.topic || ""}\nContent:\n${c.text}`;
    }
    return formatDocHeader(m, enrichChunkVersion(c)) + c.text;
  }).join("\n\n---\n\n");
}

function extractThinking(text) {
  if (!text) return { thinking: "", answer: "" };
  let thinking = "";
  // Qwen3-style <think>...</think> blocks (may appear multiple times)
  const thinkRe = /<think>([\s\S]*?)<\/think>/gi;
  let m;
  while ((m = thinkRe.exec(text)) !== null) {
    thinking += (thinking ? "\n\n" : "") + m[1].trim();
  }
  let answer = String(text).replace(thinkRe, "").trim();
  // Legacy rows may hold a lone closing </think> without an opener —
  // treat everything before it as thinking.
  if (!thinking && /<\/think>/i.test(answer)) {
    const idx = answer.toLowerCase().lastIndexOf("</think>");
    thinking = answer.slice(0, idx).replace(/<think>/gi, "").trim();
    answer = answer.slice(idx + 8).trim();
  }
  // Handle unclosed trailing <think> block (e.g. mid-stream)
  const openIdx = answer.toLowerCase().lastIndexOf("<think>");
  if (openIdx !== -1) {
    thinking += (thinking ? "\n\n" : "") + answer.slice(openIdx + 7).trim();
    answer = answer.slice(0, openIdx).trim();
  }
  // Remove stray tags
  answer = answer.replace(/<\/?think>/gi, "").trim();
  return { thinking: thinking.trim(), answer };
}

// Visible (untagged) chain-of-thought some models emit even with think:false,
// e.g. "Let me think about this..." paragraphs before the real answer.
// Conservative: only strip LEADING paragraphs that match CoT openers.
const COT_OPENER_RE = /^(let me think|thinking(\s+about|\s+through)?|let me (analyze|analyse|reason|work through|check|look)|okay,?\s+(so\s+)?let me|alright,?\s+let me|hmm[,.]|first,?\s+(i need to \w+|(let me|i('ll| will)\s+)?(think|analyze|analyse|reason|check|look))|i need to (think|analyze|analyse|reason|work through)|i('ll| will) (think|reason|analyze|analyse)( this)? (through|step by step)|reasoning:|internal (monologue|reasoning):|let me work through)/i;

function stripVisibleReasoning(answer) {
  if (!answer) return { answer: "", stripped: 0 };
  const paras = String(answer).split(/\n{2,}/);
  let stripped = 0;
  while (paras.length > 1 && stripped < 4 && COT_OPENER_RE.test(paras[0].trim())) {
    paras.shift();
    stripped++;
  }
  // Single-paragraph "Thinking... Answer" case: cut a leading CoT sentence
  // only if substantive text remains after it.
  if (stripped === 0 && paras.length === 1) {
    const m = paras[0].match(/^(.{10,300}?[.?!])\s+(?=[A-Z0-9"(])/);
    if (m && COT_OPENER_RE.test(m[1].trim())) {
      const rest = paras[0].slice(m[0].length).trim();
      if (rest.length >= 20) return { answer: rest, stripped: 1 };
    }
  }
  return { answer: paras.join("\n\n").trim(), stripped };
}

/** Final answer cleanup: tags first, then visible reasoning. Never throws. */
function cleanFinalAnswer(raw) {
  try {
    const { thinking, answer } = extractThinking(raw || "");
    const { answer: cleaned } = stripVisibleReasoning(answer);
    return { answer: cleaned, thinking };
  } catch {
    return { answer: String(raw || "").trim(), thinking: "" };
  }
}

// --- Version-conflict SYSTEM NOTE (Bug 2, detected in code, not by the LLM) ---
function describeVersion(v) {
  return [
    v.version ? `v${v.version}` : null,
    v.effectiveDate || null,
    v.status ? String(v.status).toUpperCase() : null,
  ].filter(Boolean).join(" ") || "unknown version";
}

function dateOnly(s) {
  const m = String(s || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** Latest chunk (by effective date, then version) valid on/before `isoDate`. */
function pickValidForDate(enriched, isoDate) {
  const valid = enriched.filter((e) => {
    const d = dateOnly(e.v.effectiveDate);
    return d && d <= isoDate;
  });
  if (valid.length === 0) return null;
  const { pickPreferred } = require("../evidence/conflicts");
  return pickPreferred(valid.map((e) => e.chunk));
}

/**
 * buildConflictNote(chunks, question) -> string|null
 * Groups enriched chunks by document; when one document spans differing
 * versions/dates/statuses, returns an explicit SYSTEM NOTE naming the
 * preferred source. If the question mentions a past date/year, the preferred
 * source is the version valid for that date instead of active/latest.
 */
function buildConflictNote(chunks, question) {
  try {
    const { detectConflicts, pickPreferred, chunkVersionInfo } = require("../evidence/conflicts");
    const { parseQueryDates } = require("../scoring/weights");
    const list = Array.isArray(chunks) ? chunks : [];
    if (list.length < 2) return null;

    // Attach enriched version info so detection works even when Chroma
    // metadata lacks version fields (SQLite fallback inside).
    const enriched = list.map((c, i) => {
      const v = enrichChunkVersion(c);
      return {
        chunk: {
          ...c,
          metadata: {
            ...(c.metadata || {}),
            version: v.version ?? c.metadata?.version,
            effectiveDate: v.effectiveDate ?? c.metadata?.effectiveDate,
            status: v.status ?? c.metadata?.status,
          },
        },
        v,
        index: i,
      };
    });

    const forDetection = enriched.map((e) => e.chunk);
    const conflicts = detectConflicts(forDetection);
    if (conflicts.length === 0) return null;

    const dates = parseQueryDates(question || "");
    const requestedDate = dates.length > 0 ? dateOnly(dates[0].iso) || dates[0].iso.slice(0, 10) : null;

    const notes = [];
    for (const conflict of conflicts) {
      const involved = enriched.filter((e) =>
        conflict.chunkIds.includes(String(e.chunk.chunkId ?? e.chunk.id ?? `c${e.index}`))
      );
      let preferredChunk = null;
      let basis = "active/latest version";
      if (requestedDate) {
        const dated = pickValidForDate(involved, requestedDate);
        if (dated) {
          preferredChunk = dated;
          basis = `version valid for the requested date ${requestedDate}`;
        }
      }
      if (!preferredChunk) {
        preferredChunk = pickPreferred(involved.map((e) => e.chunk));
      }
      const prefInfo = chunkVersionInfo(preferredChunk);
      const prefLabel = describeVersion({
        version: prefInfo.version,
        effectiveDate: prefInfo.effectiveDate,
        status: prefInfo.status,
      });
      const others = involved
        .filter((e) => e.chunk !== preferredChunk)
        .map((e) => `"${e.chunk.metadata?.filename || "document"}" (${describeVersion(e.v)})`)
        .join(", ");
      notes.push(
        `Document "${conflict.docKey}" appears in multiple versions. ` +
        `Use the ${basis}: ${prefLabel}. ` +
        (others ? `Superseded/older source(s): ${others}. ` : "") +
        `Explicitly mention this version conflict in the answer.`
      );
    }
    return `SYSTEM NOTE — VERSION CONFLICT (detected in code, not by the model): ${notes.join(" ")}`;
  } catch {
    return null;
  }
}
function formatConversationHistory(history) {
  if (!history || history.length === 0) return "";
  return history.map((m) => `User: ${m.question}\nAssistant: ${m.answer}`).join("\n\n");
}

// --- Version metadata for prompt context (Bug 2) ---
// Chroma chunk metadata may already carry version fields; otherwise fall back
// to the latest document_versions row in SQLite (best-effort, never fatal).
const VERSION_KEYS = ["version", "documentVersion", "docVersion"];
const EFFECTIVE_DATE_KEYS = ["effectiveDate", "effective_date", "effectiveDateISO"];
const STATUS_KEYS = ["status", "docStatus", "documentStatus"];

function pickMetaValue(meta, keys) {
  for (const k of keys) {
    const v = meta?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function enrichChunkVersion(chunk) {
  const meta = chunk?.metadata || {};
  let version = pickMetaValue(meta, VERSION_KEYS);
  let effectiveDate = pickMetaValue(meta, EFFECTIVE_DATE_KEYS);
  let status = pickMetaValue(meta, STATUS_KEYS);
  if (version !== null && effectiveDate !== null && status !== null) {
    return { version, effectiveDate, status };
  }
  try {
    const documentId = meta.documentId ?? null;
    if (documentId !== null && (version === null || effectiveDate === null || status === null)) {
      const { getDb } = require("../database/db");
      const row = getDb().prepare(
        "SELECT version, effective_date, status FROM document_versions WHERE document_id = ? ORDER BY version_id DESC LIMIT 1"
      ).get(documentId);
      if (row) {
        if (version === null && row.version) version = String(row.version);
        if (effectiveDate === null && row.effective_date) effectiveDate = String(row.effective_date);
        if (status === null && row.status) status = String(row.status);
      }
    }
  } catch {}
  return { version, effectiveDate, status };
}

function formatDocHeader(m, v) {
  const status = (v.status || "unknown").toUpperCase();
  return `[DOCUMENT]\nFilename: ${m.filename || "document"}\nPage: ${m.pageNumber ?? m.page ?? "?"}\nSection: ${m.sectionTitle || m.section || "—"}\nVersion: ${v.version || "—"}\nEffective date: ${v.effectiveDate || "—"}\nStatus: ${status}\nChunk: ${m.chunkIndex ?? "?"}\nContent:\n`;
}

function buildPrompt(contextChunks, question, conversationHistory = []) {
  if (!contextChunks || contextChunks.length === 0) return null;
  const ctx = formatContext(contextChunks);
  const convo = formatConversationHistory(conversationHistory);
  const convoBlock = convo ? `\n\nCONVERSATION HISTORY (previous turns in this session — use it to resolve follow-ups like "it", "that", "more"):\n${convo}\n` : "";
  const conflictNote = buildConflictNote(contextChunks, question);
  const noteBlock = conflictNote ? `\n${conflictNote}\n` : "";
  return `${SYSTEM_PROMPT}\n\nCONTEXT:\n${ctx}${convoBlock}${noteBlock}\nQUESTION:\n${question}\n\nANSWER:`;
}

// Ollama request helpers (Bug 1): think:false is sent when supported —
// older servers that reject the `think` field get one retry without it.
function buildGenerateBody({ prompt, stream }) {
  return { model: ANSWER_MODEL, prompt, stream, think: false, options: { temperature: 0.4, num_predict: NUM_PREDICT } };
}

function thinkFieldRejected(status, errText) {
  return status === 400 && /think/i.test(String(errText || ""));
}

function logTruncation(data, where) {
  if (data && data.done_reason === "length") {
    console.warn(`[llmService] output truncated (done_reason=length, num_predict=${NUM_PREDICT}) at ${where}; raise LLM_NUM_PREDICT if answers are cut off.`);
  }
}

async function postGenerate(body, url) {
  const res = await fetch(url || `${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    if ("think" in body && thinkFieldRejected(res.status, errText)) {
      console.warn("[llmService] Ollama server rejected the `think` field; retrying once without it.");
      const { think, ...fallbackBody } = body;
      void think;
      const retry = await fetch(url || `${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fallbackBody),
      });
      if (!retry.ok) {
        throw new Error(`Ollama generate failed: ${retry.status} ${await retry.text()}`);
      }
      return retry;
    }
    throw new Error(`Ollama generate failed: ${res.status} ${errText}`);
  }
  return res;
}

async function generateAnswer(question, contextChunks, conversationHistory = []) {
  const prompt = buildPrompt(contextChunks, question, conversationHistory);
  if (!prompt) return { answer: "", thinking: "" };
  const res = await postGenerate(buildGenerateBody({ prompt, stream: false }));
  const data = await res.json();
  logTruncation(data, "generateAnswer");
  const nativeThinking = (data.thinking || "").trim();
  const { thinking: tagThinking, answer } = cleanFinalAnswer(data.response || "");
  const thinking = [nativeThinking, tagThinking].filter(Boolean).join("\n\n").trim();
  return { answer: (answer || "").trim(), thinking };
}

async function streamAnswer(question, contextChunks, onToken, conversationHistory = [], onThinking) {
  // Allow streamAnswer(question, chunks, historyArray) without callback
  if (typeof onToken !== "function" && Array.isArray(onToken)) {
    conversationHistory = onToken;
    onToken = () => {};
  }
  if (typeof conversationHistory === "function") {
    onThinking = conversationHistory;
    conversationHistory = [];
  }
  const prompt = buildPrompt(contextChunks, question, conversationHistory);
  if (!prompt) return "";
  const res = await postGenerate(buildGenerateBody({ prompt, stream: true }));
  if (!res.body) throw new Error("Ollama returned no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawAnswer = "";
  let nativeThinking = "";
  let prevClean = "";
  let lastDoneReason = null;

  function emitCleanDiff() {
    const { answer: clean } = extractThinking(rawAnswer);
    if (clean.length > prevClean.length && clean.startsWith(prevClean)) {
      const diff = clean.slice(prevClean.length);
      prevClean = clean;
      try { onToken(diff); } catch {}
    } else if (clean !== prevClean) {
      // Fallback (should be rare): resync
      prevClean = clean;
    }
  }

  function processLine(line) {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    if (data.done_reason) lastDoneReason = data.done_reason;
    if (data.thinking) {
      nativeThinking += data.thinking;
      if (typeof onThinking === "function") { try { onThinking(data.thinking); } catch {} }
    }
    if (data.response) {
      rawAnswer += data.response;
      emitCleanDiff();
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) processLine(line);
    if (done) break;
  }
  processLine(buffer);
  logTruncation({ done_reason: lastDoneReason }, "streamAnswer");
  const { thinking: tagThinking, answer: cleanAnswer } = cleanFinalAnswer(rawAnswer);
  const thinking = [nativeThinking.trim(), tagThinking].filter(Boolean).join("\n\n").trim();
  const result = { answer: (cleanAnswer || "").trim(), thinking };
  // Backward compat: callers destructuring a string still work via String(result)
  return result;
}

module.exports = { generateAnswer, streamAnswer, LLM_MODEL, ANSWER_MODEL, NUM_PREDICT, OLLAMA_URL, buildPrompt, buildConflictNote, enrichChunkVersion, formatContext, formatConversationHistory, extractThinking, stripVisibleReasoning, cleanFinalAnswer, SYSTEM_PROMPT };
