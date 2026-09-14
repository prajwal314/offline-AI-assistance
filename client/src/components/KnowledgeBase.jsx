import { useEffect, useState } from "react";
const BASE = "http://localhost:5000/api/knowledge-base";
export default function KnowledgeBase() {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    const r = await fetch(`${BASE}/status`); const j = await r.json(); if (j.success) setS(j);
  }
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, []);
  async function build() {
    if (!confirm("Build knowledge base from uploaded docs via web search? Requires OLLAMA_API_KEY.")) return;
    setLoading(true);
    await fetch(`${BASE}/build`, { method: "POST" });
    setLoading(false);
  }
  if (!s) return <div className="p-4 text-sm">Loading KB status...</div>;
  const isProcessing = s.status === "processing";
  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="font-semibold mb-2">Knowledge Base — Internet Research</h2>
      <button onClick={build} disabled={isProcessing || loading} className="px-4 py-1 bg-purple-600 text-white rounded text-sm disabled:opacity-50">
        {isProcessing ? "Building..." : "Search Internet & Build Knowledge Base"}
      </button>
      <div className="mt-3 text-sm grid grid-cols-2 gap-2">
        <div>Status: <b>{s.status}</b> — {s.currentStep}</div>
        <div>Documents: {s.documents}</div>
        <div>Web Sources: {s.webSources} / {s.webTotal} total</div>
        <div>Chunks: {s.totalChunks}</div>
        <div>Progress: {s.processedSources} / {s.totalSources} (failed {s.failedSources})</div>
        <div>Created chunks: {s.chunksCreated}</div>
      </div>
      <button onClick={load} className="mt-2 text-xs text-blue-600 underline">Refresh</button>
    </div>
  );
}
