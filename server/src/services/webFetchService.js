async function webFetch(url) {
  const key = process.env.OLLAMA_API_KEY;
  if (!key) throw new Error("OLLAMA_API_KEY not set");
  const res = await fetch("https://ollama.com/api/web_fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`web_fetch failed ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { title: data.title || "", content: data.content || "", links: data.links || [], url };
}

module.exports = { webFetch };
