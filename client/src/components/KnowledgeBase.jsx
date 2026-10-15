import { useEffect, useState } from "react";
const BASE = "http://localhost:5000/api/knowledge-base";

function useKBStatus(pollMs = 3000) {
  const [s, setS] = useState(null);
  async function load() {
    try {
      const r = await fetch(`${BASE}/status`);
      const j = await r.json();
      if (j.success) setS(j);
    } catch {}
  }
  useEffect(() => { load(); const id = setInterval(load, pollMs); return () => clearInterval(id); }, [pollMs]);
  return [s, load];
}

export function BuildKBButton() {
  const [s, load] = useKBStatus();
  const [loading, setLoading] = useState(false);
  async function build() {
    if (!confirm("Build your knowledge base from the web using research sources. This will add new web content and keep Q&A local.")) return;
    setLoading(true);
    try { await fetch(`${BASE}/build`, { method: "POST" }); await load(); } catch {}
    setLoading(false);
  }
  const isProcessing = s?.status === "processing";
  const busy = isProcessing || loading;
  return (
    <div>
      <button onClick={build} disabled={busy} title="Internet is used only during knowledge building. Q&A stays local/offline." className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition shadow-sm px-3 py-1.5 text-xs">
        {busy ? <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : null}
        {isProcessing ? "Building…" : "Search Internet & Build Knowledge Base"}
      </button>
      {isProcessing && (
        <div className="mt-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-2 py-1">
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-amber-800 dark:text-amber-300"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />{s.currentStep}</div>
        </div>
      )}
    </div>
  );
}

export function InternetResearch({ compact = false, fill = false }) {
  const [s] = useKBStatus();
  if (!s) return <div className="flex items-center gap-2 p-4 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg"><span className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 rounded-full border-t-indigo-600 animate-spin" />Loading research…</div>;
  const isProcessing = s.status === "processing";
  return (
    <div className={`overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-card flex flex-col ${compact ? "rounded-lg" : "rounded-xl"} ${fill ? "flex-1 min-h-0 h-full" : ""}`}>
      <div className={`flex gap-2 items-center ${compact ? "px-3 pt-3" : "px-5 pt-5"}`}>
        <div className={`flex items-center justify-center text-indigo-600 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-800 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 shrink-0 ${compact ? "w-7 h-7 text-sm" : "w-9 h-9"}`}>🌐</div>
        <div className="flex-1 min-w-0">
          <h2 className={`${compact ? "text-xs" : "text-sm"} font-semibold text-gray-900 dark:text-gray-100`}>Internet Research</h2>
          {compact && <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">Web → local KB · Q&A stays offline</p>}
        </div>
      </div>
      <div className={`${compact ? "px-3 pt-2 pb-3" : "px-5 pt-4 pb-5"}`}>
        {isProcessing && (
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 px-2 py-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />{s.currentStep}</div>
          </div>
        )}

        <div className={`grid grid-cols-2 gap-1.5 ${compact ? "mt-2" : "mt-4 lg:grid-cols-3"}`}>
          {[
            ["Status", <span key="0" className={`inline-flex px-1.5 py-0 rounded-full text-[10px] font-medium border ${isProcessing ? "bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300" : "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"}`}>{s.status}</span>, s.currentStep?.slice(0,18) || "—"],
            ["Documents", s.documents, "Indexed"],
            ["Web Sources", `${s.webSources} / ${s.webTotal}`, "Collected"],
            ["Total Chunks", s.totalChunks, "Embeddings"],
            ["Progress", `${s.processedSources} / ${s.totalSources}`, `failed ${s.failedSources}`],
            ["Chunks +", s.chunksCreated, "This run"],
          ].map(([label, val, hint]) => (
            <div key={label} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/50 px-2 py-1.5 min-w-0">
              <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400 truncate">{label}</div>
              <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">{val}</div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{hint}</div>
            </div>
          ))}
        </div>
        {fill && <div className="flex-1 min-h-[8px] hidden lg:block" />}
      </div>
    </div>
  );
}

export function ResearchSources({ compact = false, fill = false }) {
  const [s, load] = useKBStatus();
  if (!s) return <div className="flex items-center gap-2 p-4 text-xs text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg"><span className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 rounded-full border-t-indigo-600 animate-spin" />Loading sources…</div>;
  return (
    <div className={`overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-card flex flex-col min-h-0 ${compact ? "rounded-lg" : "rounded-xl"} ${fill ? "flex-1 h-full" : ""}`}>
      <div className={`flex items-center justify-between border-b border-gray-100 dark:border-gray-800 shrink-0 ${compact ? "px-3 py-2" : "px-5 py-4"}`}>
        <div className="min-w-0">
          <h3 className={`${compact ? "text-xs" : "text-sm"} font-semibold text-gray-900 dark:text-gray-100`}>Research Sources</h3>
          <p className="text-[10px] text-gray-500 dark:text-gray-400">{(s.sources || []).length} sources</p>
        </div>
        <button onClick={load} className="px-1.5 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-300 transition rounded-md hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 shrink-0">Refresh</button>
      </div>
      <div className={`overflow-auto flex-1 min-h-0 ${compact ? "max-h-[220px] lg:max-h-none" : "max-h-[320px] lg:max-h-none"}`}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
            <tr className="text-[10px] font-semibold tracking-widest uppercase text-gray-500 dark:text-gray-400">
              <th className="px-2.5 py-1.5 font-semibold text-left">Source</th>
              <th className="px-2.5 py-1.5 font-semibold text-center">Status</th>
              <th className="px-2.5 py-1.5 font-semibold text-right">Open</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {(s.sources || []).map((r) => (
              <tr key={r.id} className="transition hover:bg-gray-50/60 dark:hover:bg-gray-800/60">
                <td className="px-2.5 py-2 min-w-0">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate max-w-[160px] text-[11px]" title={r.title}>{r.title?.slice(0, 60) || "Untitled source"}</div>
                  <a href={r.url} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-600 dark:text-indigo-300 hover:underline truncate max-w-[160px] inline-block" title={r.url}>{r.url ? new URL(r.url).hostname : ""}</a>
                  {r.topic && <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[160px]" title={r.topic}>{r.topic}</div>}
                </td>
                <td className="px-2.5 py-2 text-center whitespace-nowrap">
                  {r.status === "completed" ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">✓ Done</span> : r.status === "failed" ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400" title={r.error}>✕ Failed</span> : <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">● {r.status}</span>}
                </td>
                <td className="px-2.5 py-2 text-right"><a href={r.url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center text-gray-500 dark:text-gray-400 transition bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md w-6 h-6 text-xs hover:bg-indigo-50 dark:hover:bg-indigo-900/30 hover:border-indigo-200 dark:hover:border-indigo-700 hover:text-indigo-600 dark:hover:text-indigo-300" title="Open">↗</a></td>
              </tr>
            ))}
            {(!s.sources || s.sources.length === 0) && <tr><td colSpan={3} className="px-3 py-8 text-center text-[11px] text-gray-400 dark:text-gray-500">No sources yet — run Internet Research.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Backwards-compatible combined view (not used in new layout, kept for safety)
export default function KnowledgeBase({ compact = false }) {
  return (
    <section className={`flex flex-col min-h-0 ${compact ? "space-y-2" : "space-y-3"}`}>
      <InternetResearch compact={compact} />
      <ResearchSources compact={compact} />
    </section>
  );
}
