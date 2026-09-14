const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";

function sampleDocumentText(docs, maxChars = 8000) {
  const texts = docs.map((d) => d.extracted_text || "").filter(Boolean);
  if (texts.length === 0) return "";
  let combined = texts.join("\n\n--- DOCUMENT BOUNDARY ---\n\n");
  if (combined.length > maxChars) combined = combined.slice(0, maxChars);
  return combined;
}

async function extractTopics(docs) {
  const sample = sampleDocumentText(docs);
  if (!sample || sample.trim().length < 50) throw new Error("Not enough document text for topic extraction");

  const prompt = `Analyze the following document excerpts and Extract 5-10 important topics as concise keywords or short phrases.
Rules:
- Return ONLY valid JSON: {"topics":["topic1","topic2"]}
- 5-10 topics, no duplicates, lowercase preferred, 2-4 words each
- Be specific, not generic
- No explanation, no markdown

Excerpts:
${sample}

JSON:`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, think: false, format: "json" }),
  });
  if (!res.ok) throw new Error(`Topic extraction failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  let raw = (data.response || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error("LLM did not return JSON for topics: " + raw.slice(0, 300));
  }
  let topics = (parsed.topics || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
  topics = [...new Set(topics)].slice(0, 10);
  if (topics.length < 3) throw new Error("Too few topics extracted");
  return { topics };
}

module.exports = { extractTopics, sampleDocumentText };
