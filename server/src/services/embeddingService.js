const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "qwen3-embedding:0.6b";

async function generateEmbedding(text) {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    throw new Error("Text is required for embedding");
  }

  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama embedding failed: ${res.status} ${errText}`);
  }

  const data = await res.json();

  if (!data.embeddings || !Array.isArray(data.embeddings) || data.embeddings.length === 0) {
    throw new Error("Invalid embedding response from Ollama");
  }

  return data.embeddings[0];
}

async function generateEmbeddings(texts) {
  if (!Array.isArray(texts) || texts.length === 0) {
    throw new Error("texts must be a non-empty array");
  }

  const cleaned = texts.map((t) => (typeof t === "string" ? t : String(t)));

  const res = await fetch(`${OLLAMA_URL}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: cleaned,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Ollama embedding failed: ${res.status} ${errText}`);
  }

  const data = await res.json();

  if (!data.embeddings || !Array.isArray(data.embeddings)) {
    throw new Error("Invalid embedding response from Ollama");
  }

  return data.embeddings;
}

module.exports = {
  generateEmbedding,
  generateEmbeddings,
  EMBEDDING_MODEL,
  OLLAMA_URL,
};
