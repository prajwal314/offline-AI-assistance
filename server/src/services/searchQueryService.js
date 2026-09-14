const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const LLM_MODEL = process.env.LLM_MODEL || "qwen3:4b";

async function generateQueries(topics) {
  if (!Array.isArray(topics) || topics.length === 0) throw new Error("topics required");
  const prompt = `Given topics: ${JSON.stringify(topics)}
Generate 2-3 focused web search queries per topic (total 6-12 queries). Rules:
- Return ONLY JSON: {"queries":["query1","query2"]}
- Queries 3-8 words, specific, no duplicates, no quotes
- Cover fundamentals, recent developments, applications where relevant
JSON:`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: LLM_MODEL, prompt, stream: false, think: false, format: "json" }),
  });
  if (!res.ok) throw new Error(`Query generation failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  let raw = (data.response || "").trim();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error("LLM did not return JSON for queries");
  }
  let queries = (parsed.queries || []).map((q) => String(q).trim()).filter(Boolean);
  queries = [...new Set(queries.map((q) => q.toLowerCase()))].map((q) => queries.find((o) => o.toLowerCase() === q)).slice(0, 12);
  if (queries.length === 0) throw new Error("No queries generated");
  return { queries };
}

module.exports = { generateQueries };
