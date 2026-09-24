function normalizeFetchUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function extractTitleFromWikipediaUrl(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/^\//, "");
    if (path.startsWith("wiki/")) return decodeURIComponent(path.replace(/^wiki\//, "")).replace(/_/g, " ");
    return decodedURIComponent(parsed.pathname.split("/").pop() || "");
  } catch {
    return "Wikipedia article";
  }
}

async function ollamaWebFetch(url) {
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

async function wikipediaWebFetch(url) {
  const target = normalizeFetchUrl(url);
  const parsed = new URL(target);
  const title = extractTitleFromWikipediaUrl(target);
  const pageTitle = parsed.pathname.includes("/wiki/") ? decodeURIComponent(parsed.pathname.replace(/^\//, "").replace(/^wiki\//, "")) : title;
  const endpoint = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&redirects=1&format=json&origin=*&titles=${encodeURIComponent(pageTitle)}`;
  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`Wikipedia fetch failed ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const page = Object.values(data?.query?.pages || {})[0];
  if (!page || !page.extract) {
    throw new Error("Wikipedia article content is unavailable");
  }

  return {
    title: page.title || title || "Wikipedia article",
    content: page.extract.trim(),
    links: [],
    url: target,
  };
}

async function webFetch(url) {
  const key = process.env.OLLAMA_API_KEY;
  if (key) return ollamaWebFetch(url);
  return wikipediaWebFetch(url);
}

module.exports = { webFetch };
