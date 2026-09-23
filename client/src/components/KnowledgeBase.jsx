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
  if (!s) return <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500 flex items-center gap-2"><span className="w-4 h-4 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />Loading research status…</div>;
  const isProcessing = s.status === "processing";
  return (
    <section className="space-y-3">
      <div className="bg-white border border-gray-200 rounded-xl shadow-card overflow-hidden">
        <div className="px-5 pt-5 flex gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">🌐</div>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-900">Internet Research</h2>
            <p className="text-xs text-gray-500">Expand your local knowledge base with web research</p>
          </div>
        </div>
        <div className="px-5 pb-5 pt-4">
          <button onClick={build} disabled={isProcessing || loading} className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold transition shadow-sm">
            {isProcessing ? <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
            {isProcessing ? "Building Knowledge Base…" : "Search Internet & Build Knowledge Base"}
          </button>
          <p className="text-[11px] text-gray-500 mt-2">Internet is used only during knowledge building. Normal Q&A remains local/offline.</p>

          {isProcessing && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <div className="text-xs font-medium text-amber-800 flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />Researching… — {s.currentStep}</div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-[11px] text-amber-700">
                <span>● Identifying topics</span><span>● Searching web</span><span>● Fetching sources</span><span>● Creating embeddings</span><span>● Updating KB</span>
              </div>
            </div>
          )}

          <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
            {[
              ["Status", <span key="0" className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium border ${isProcessing ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>{s.status}</span>, s.currentStep],
              ["Documents", s.documents, "Indexed"],
              ["Web Sources", `${s.webSources} / ${s.webTotal}`, "Collected"],
              ["Total Chunks", s.totalChunks, "Embeddings"],
              ["Progress", `${s.processedSources} / ${s.totalSources}`, `failed ${s.failedSources}`],
              ["Chunks Created", s.chunksCreated, "This run"],
            ].map(([label, val, hint]) => (
              <div key={label} className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-2.5">
                <div className="text-[11px] font-medium text-gray-500">{label}</div>
                <div className="text-sm font-semibold text-gray-900 truncate">{val}</div>
                <div className="text-[11px] text-gray-500 truncate">{hint}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-card overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Research Sources</h3>
            <p className="text-xs text-gray-500">{(s.sources || []).length} sources collected</p>
          </div>
          <button onClick={load} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-md hover:bg-indigo-50 transition">Refresh</button>
        </div>
        <div className="overflow-auto max-h-[320px]">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 sticky top-0">
              <tr className="text-[11px] font-semibold tracking-widest uppercase text-gray-500">
                <th className="text-left px-3 py-2 font-semibold">Source</th>
                <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Topic</th>
                <th className="text-center px-3 py-2 font-semibold">Type</th>
                <th className="text-center px-3 py-2 font-semibold">Status</th>
                <th className="text-right px-3 py-2 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(s.sources || []).map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/60 transition">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-gray-900 truncate max-w-[220px]" title={r.title}>{r.title?.slice(0, 60) || "Untitled source"}</div>
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-[11px] text-indigo-600 hover:underline truncate max-w-[220px] inline-block" title={r.url}>{r.url ? new URL(r.url).hostname : ""} · {r.url?.slice(0, 28)}…</a>
                  </td>
                  <td className="px-3 py-2 text-gray-600 hidden sm:table-cell max-w-[140px] truncate" title={r.topic}>{r.topic || "—"}</td>
                  <td className="px-3 py-2 text-center"><span className="inline-flex px-2 py-0.5 rounded-full bg-white border border-gray-200 text-[11px] font-medium text-gray-600">Web</span></td>
                  <td className="px-3 py-2 text-center">
                    {r.status === "completed" ? <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">✓ Completed</span> : r.status === "failed" ? <span className="inline-flex items-center gap-1 text-red-600 font-medium" title={r.error}>✕ Failed</span> : <span className="inline-flex items-center gap-1 text-amber-600 font-medium">● {r.status}</span>}
                  </td>
                  <td className="px-3 py-2 text-right"><a href={r.url} target="_blank" rel="noreferrer" className="inline-flex w-7 h-7 items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 text-gray-500 hover:text-indigo-600 transition" title="Open">↗</a></td>
                </tr>
              ))}
              {(!s.sources || s.sources.length === 0) && <tr><td colSpan={5} className="px-3 py-10 text-center text-gray-400">No research sources yet — run Internet Research to collect sources.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
