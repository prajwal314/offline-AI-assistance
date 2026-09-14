const BASE_URL = "http://localhost:5000/api";

export async function checkHealth() {
  const res = await fetch(`${BASE_URL}/health`);
  return res.json();
}

export async function uploadDocument(file) {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${BASE_URL}/documents/upload`, { method: "POST", body: fd });
  return res.json();
}

export async function listDocuments() {
  const res = await fetch(`${BASE_URL}/documents`);
  return res.json();
}

export async function deleteDocument(id) {
  const res = await fetch(`${BASE_URL}/documents/${id}`, { method: "DELETE" });
  return res.json();
}

export async function sendChat(question, topK = 5) {
  const res = await fetch(`${BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, topK }),
  });
  return res.json();
}

export async function getHistory() {
  const res = await fetch(`${BASE_URL}/chat/history`);
  return res.json();
}

export async function getStats() {
  const res = await fetch(`${BASE_URL}/chat/stats`);
  return res.json();
}
export async function buildKB() {
  const res = await fetch(`${BASE_URL}/knowledge-base/build`, { method: "POST" });
  return res.json();
}
export async function getKBStatus() {
  const res = await fetch(`${BASE_URL}/knowledge-base/status`);
  return res.json();
}
