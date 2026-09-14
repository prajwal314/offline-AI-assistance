const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";

const SYSTEM_PROMPT = `You are an AI assistant that answers questions based ONLY on the provided context.
If the context does not contain the answer, say you don't have enough information from the documents.
Be concise, accurate, and helpful. Cite sources when possible.`;

function buildPrompt(context, question) {
  const ctx = context && context.trim().length > 0 ? context : "No relevant context found.";
  return `${SYSTEM_PROMPT}\n\nCONTEXT:\n${ctx}\n\nQUESTION:\n${question}\n\nANSWER:`;
}

async function generateAnswer(question, contextChunks) {
  const context = (contextChunks || []).map((c) => c.text).join("\n\n---\n\n");
  const prompt = buildPrompt(context, question);

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      prompt,
      stream: false,
      think: false,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama generate failed: ${res.status} ${errText}`);
  }

  const data = await res.json();
  return (data.response || "").trim();
}

module.exports = { generateAnswer, LLM_MODEL, OLLAMA_URL, buildPrompt };
