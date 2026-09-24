function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wikiTitleToUrl(title) {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, "_"))}`;
}

async function ollamaWebSearch(query, maxResults) {
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

async function wikipediaWebSearch(query, maxResults) {
  const endpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&utf8=1&origin=*`;
  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Wikipedia search failed ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const results = (data?.query?.search || [])
    .map((item) => ({
      title: item.title || "Wikipedia result",
      url: wikiTitleToUrl(item.title || ""),
      snippet: stripHtml(item.snippet || ""),
    }))
    .filter((item) => item.title && item.url);

  if (results.length === 0) {
    throw new Error("Wikipedia returned no search results");
  }

  return results.slice(0, Math.max(1, Number(maxResults) || 5));
}

async function webSearch(query, maxResults = 5) {
  const key = process.env.OLLAMA_API_KEY;
  if (key) return ollamaWebSearch(query, maxResults);
  return wikipediaWebSearch(query, maxResults);
}

module.exports = { webSearch };
