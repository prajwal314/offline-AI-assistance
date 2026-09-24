const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";

const SYSTEM_PROMPT = `You are a RAG assistant. Follow these rules strictly:
1. Answer ONLY using the supplied CONTEXT.
2. Do NOT invent facts not in CONTEXT.
3. If CONTEXT is insufficient, say: "I could not find enough relevant information in the knowledge base to answer this question."
4. Distinguish [DOCUMENT] vs [WEB] sources when citing.
5. Be concise. Mention the relevant source filename or URL when possible.
6. If sources disagree, state the disagreement explicitly.
7. Do NOT claim a fact is in a document unless it appears verbatim in CONTEXT.`;

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

function buildPrompt(contextChunks, question) {
  if (!contextChunks || contextChunks.length === 0) return null;
  const ctx = formatContext(contextChunks);
  return `${SYSTEM_PROMPT}\n\nCONTEXT:\n${ctx}\n\nQUESTION:\n${question}\n\nANSWER:`;
}

async function generateAnswer(question, contextChunks) {
  const prompt = buildPrompt(contextChunks, question);
  if (!prompt) return null;
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, think: false }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${errText}`);
  }
  const data = await res.json();
  return (data.response || "").trim();
}

async function streamAnswer(question, contextChunks, onToken) {
  const prompt = buildPrompt(contextChunks, question);
  if (!prompt) return "";
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, prompt, stream: true, think: false }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${errText}`);
  }
  if (!res.body) throw new Error("Ollama returned no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";

  function processLine(line) {
    if (!line.trim()) return;
    const data = JSON.parse(line);
    if (data.response) {
      answer += data.response;
      onToken(data.response);
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
  return answer.trim();
}

module.exports = { generateAnswer, streamAnswer, LLM_MODEL, OLLAMA_URL, buildPrompt, formatContext, SYSTEM_PROMPT };
