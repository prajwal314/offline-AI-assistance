import { useEffect, useState } from "react";
const BASE = "http://localhost:5000/api/knowledge-base";
export default function KnowledgeBase() {
  const [s, setS] = useState(null);
  const [loading, setLoading] = useState(false);
  async function load() { const r = await fetch(`${BASE}/status`); const j = await r.json(); if (j.success) setS(j); }
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, []);
  async function build() {
    if (!confirm("Build knowledge base from uploaded docs via web search? Requires OLLAMA_API_KEY. Internet required.")) return;
    setLoading(true); await fetch(`${BASE}/build`, { method: "POST" }); setLoading(false);
  }
  if (!s) return <div className="p-4 text-sm">Loading KB status...</div>;
  const isProcessing = s.status === "processing";
  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="font-semibold mb-2">Knowledge Base — Internet Research</h2>
      <button onClick={build} disabled={isProcessing || loading} className="px-4 py-1 bg-purple-600 text-white rounded text-sm disabled:opacity-50">
        {isProcessing ? "Building..." : "Search Internet & Build Knowledge Base"}
      </button>
      <span className="ml-2 text-xs text-gray-500">🌐 Internet required only here — Q&A works offline</span>
      <div className="mt-3 text-sm grid grid-cols-2 gap-2">
        <div>Status: <b>{s.status}</b> — {s.currentStep}</div>
        <div>Documents: {s.documents}</div>
        <div>Web Sources: {s.webSources} / {s.webTotal} total</div>
        <div>Chunks: {s.totalChunks}</div>
        <div>Progress: {s.processedSources} / {s.totalSources} (failed {s.failedSources})</div>
        <div>Created chunks: {s.chunksCreated}</div>
      </div>
      <div className="mt-4">
        <div className="text-sm font-medium mb-1">Research Sources</div>
        <div className="overflow-auto max-h-64 border rounded">
          <table className="w-full text-xs">
            <thead className="bg-gray-100"><tr><th className="p-1 text-left">Title</th><th className="p-1">Topic</th><th className="p-1">URL</th><th className="p-1">Status</th></tr></thead>
            <tbody>
              {(s.sources || []).map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-1 truncate max-w-[160px]" title={r.title}>{r.title?.slice(0, 40) || "—"}</td>
                  <td className="p-1 text-center">{r.topic || "—"}</td>
                  <td className="p-1 truncate max-w-[160px]"><a href={r.url} target="_blank" rel="noreferrer" className="text-blue-600 underline">{r.url.slice(0, 30)}…</a></td>
                  <td className={`p-1 text-center ${r.status === "completed" ? "text-green-600" : r.status === "failed" ? "text-red-600" : "text-yellow-600"}`}>{r.status}{r.status === "failed" && r.error ? ` — ${r.error.slice(0, 30)}` : ""}</td>
                </tr>
              ))}
              {(!s.sources || s.sources.length === 0) && <tr><td colSpan={4} className="p-2 text-center text-gray-400">No research sources yet</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <button onClick={load} className="mt-2 text-xs text-blue-600 underline">Refresh</button>
    </div>
  );
}
