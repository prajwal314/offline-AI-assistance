const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";

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
    return `[DOCUMENT]\nFilename: ${m.filename || "document"}\nPage: ${m.pageNumber ?? m.page ?? "?"}\nChunk: ${m.chunkIndex ?? "?"}\nContent:\n${c.text}`;
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
function formatConversationHistory(history) {
  if (!history || history.length === 0) return "";
  return history.map((m) => `User: ${m.question}\nAssistant: ${m.answer}`).join("\n\n");
}

function buildPrompt(contextChunks, question, conversationHistory = []) {
  if (!contextChunks || contextChunks.length === 0) return null;
  const ctx = formatContext(contextChunks);
  const convo = formatConversationHistory(conversationHistory);
  const convoBlock = convo ? `\n\nCONVERSATION HISTORY (previous turns in this session — use it to resolve follow-ups like "it", "that", "more"):\n${convo}\n` : "";
  return `${SYSTEM_PROMPT}\n\nCONTEXT:\n${ctx}${convoBlock}\nQUESTION:\n${question}\n\nANSWER:`;
}

async function generateAnswer(question, contextChunks, conversationHistory = []) {
  const prompt = buildPrompt(contextChunks, question, conversationHistory);
  if (!prompt) return { answer: "", thinking: "" };
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, think: false, options: { temperature: 0.4, num_predict: 1000 } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  const nativeThinking = (data.thinking || "").trim();
  const { thinking: tagThinking, answer } = extractThinking(data.response || "");
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
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, prompt, stream: true, think: false, options: { temperature: 0.4, num_predict: 1000 } }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${errText}`);
  }
  if (!res.body) throw new Error("Ollama returned no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let rawAnswer = "";
  let nativeThinking = "";
  let prevClean = "";

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
  const { thinking: tagThinking, answer: cleanAnswer } = extractThinking(rawAnswer);
  const thinking = [nativeThinking.trim(), tagThinking].filter(Boolean).join("\n\n").trim();
  const result = { answer: (cleanAnswer || "").trim(), thinking };
  // Backward compat: callers destructuring a string still work via String(result)
  return result;
}

module.exports = { generateAnswer, streamAnswer, LLM_MODEL, OLLAMA_URL, buildPrompt, formatContext, formatConversationHistory, extractThinking, SYSTEM_PROMPT };
