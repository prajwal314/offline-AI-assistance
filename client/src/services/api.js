const BASE_URL = "http://localhost:5000/api";
export async function checkHealth() { const res = await fetch(`${BASE_URL}/health/all`); return res.json(); }
export async function checkOllama() { const res = await fetch(`${BASE_URL}/health/ollama`); return res.json(); }
export async function checkChroma() { const res = await fetch(`${BASE_URL}/health/chromadb`); return res.json(); }
export async function uploadDocument(file, opts = {}) { const fd = new FormData(); fd.append("file", file); if (opts.version) fd.append("version", opts.version); if (opts.effectiveDate) fd.append("effective_date", opts.effectiveDate); if (opts.status) fd.append("status", opts.status); const res = await fetch(`${BASE_URL}/documents/upload`, { method: "POST", body: fd }); return res.json(); }
export async function listDocuments() { const res = await fetch(`${BASE_URL}/documents`); return res.json(); }
export async function deleteDocument(id) { const res = await fetch(`${BASE_URL}/documents/${id}`, { method: "DELETE" }); return res.json(); }
export async function sendChat(question, topK = 5, opts = {}) {
  const body = { question, topK, threshold: opts.threshold ?? null, filter: opts.filter ?? {} };
  if (opts.sourceType) body.sourceType = opts.sourceType;
  if (opts.documentId) body.documentId = opts.documentId;
  const res = await fetch(`${BASE_URL}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}
export async function streamChat(question, topK = 5, opts = {}, onEvent) {
  const body = { question, topK, threshold: opts.threshold ?? null, filter: opts.filter ?? {} };
  if (opts.sourceType) body.sourceType = opts.sourceType;
  if (opts.documentId) body.documentId = opts.documentId;
  if (opts.sessionId !== undefined && opts.sessionId !== null && opts.sessionId !== "") body.sessionId = opts.sessionId;
  const res = await fetch(`${BASE_URL}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try { message = (await res.json()).message || message; } catch {}
    throw new Error(message);
  }
  if (!res.body) throw new Error("The server returned no response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line));
    }
    if (done) break;
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}
export async function getHistory(sessionId) {
  const url = sessionId ? `${BASE_URL}/chat/history?sessionId=${encodeURIComponent(sessionId)}` : `${BASE_URL}/chat/history`;
  const res = await fetch(url); return res.json();
}
export async function listSessions() { const res = await fetch(`${BASE_URL}/chat/sessions`); return res.json(); }
export async function createSession(title) { const res = await fetch(`${BASE_URL}/chat/sessions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: title || "New chat" }) }); return res.json(); }
export async function getSessionMessages(sessionId) { const res = await fetch(`${BASE_URL}/chat/sessions/${encodeURIComponent(sessionId)}/messages`); return res.json(); }
export async function renameSession(sessionId, title) { const res = await fetch(`${BASE_URL}/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) }); return res.json(); }
export async function deleteSession(sessionId) { const res = await fetch(`${BASE_URL}/chat/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" }); return res.json(); }
export async function getStats() { const res = await fetch(`${BASE_URL}/chat/stats`); return res.json(); }
export async function buildKB() { const res = await fetch(`${BASE_URL}/knowledge-base/build`, { method: "POST" }); return res.json(); }
export async function getKBStatus() { const res = await fetch(`${BASE_URL}/knowledge-base/status`); return res.json(); }
