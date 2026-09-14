async function webSearch(query, maxResults = 5) {
  const key = process.env.OLLAMA_API_KEY;
  if (!key) throw new Error("OLLAMA_API_KEY not set in server/.env — create key at https://ollama.com/settings/keys");
  const res = await fetch("https://ollama.com/api/web_search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: maxResults }),
  });
  if (!res.ok) throw new Error(`web_search failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const results = (data.results || []).map((r) => ({ title: r.title || "", url: r.url || "", snippet: r.content || "" }));
  return results.filter((r) => r.url);
}

module.exports = { webSearch };
