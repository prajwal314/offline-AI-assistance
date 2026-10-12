import { useEffect, useState } from "react";
import { getStats } from "../services/api";

function Stat({ label, value, hint, compact }) {
  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-card ${compact ? "rounded-lg p-2" : "rounded-xl p-4"}`}>
      <div className="text-[10px] font-semibold tracking-widest uppercase text-gray-500 dark:text-gray-400 truncate">{label}</div>
      <div className={`${compact ? "mt-0.5 text-xs" : "mt-1 text-2xl"} font-semibold tracking-tight text-gray-900 dark:text-gray-100 truncate`}>{value}</div>
      <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0 truncate">{hint}</div>
    </div>
  );
}

export default function Dashboard({ compact = false }) {
  const [stats, setStats] = useState(null);
  async function load() { try { const d = await getStats(); if (d.success) setStats(d.stats); } catch {} }
  useEffect(() => { load(); }, []);
  if (!stats) return <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2"><span className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-indigo-600 rounded-full animate-spin" />Loading knowledge base…</div>;

  return (
    <section className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-card ${compact ? "rounded-lg p-2.5" : ""}`}>
      <div className={`flex items-center justify-between ${compact ? "mb-1.5" : "mb-3"}`}>
        <div>
          <h2 className={`${compact ? "text-xs" : "text-sm"} font-semibold text-gray-900 dark:text-gray-100`}>Knowledge Base</h2>
          {!compact && <p className="text-xs text-gray-500 dark:text-gray-400">Overview of your indexed knowledge</p>}
        </div>
        <button onClick={load} className="text-[11px] font-medium text-indigo-600 dark:text-indigo-300 hover:text-indigo-700 dark:hover:text-indigo-200 px-1.5 py-0.5 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition">Refresh</button>
      </div>
      <div className={`grid gap-1.5 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"}`}>
        <Stat compact={compact} label="Documents" value={stats.total} hint={`${stats.ready ?? 0} ready`} />
        <Stat compact={compact} label="Ready" value={stats.ready} hint={`${stats.failed ?? 0} failed`} />
        <Stat compact={compact} label="Web Sources" value={stats.webSources ?? 0} hint={`${stats.webTotal ?? 0} total`} />
        <Stat compact={compact} label="Total Chunks" value={stats.chunkCount ?? 0} hint="Knowledge" />
        <Stat compact={compact} label="Doc Chunks" value={stats.docChunks ?? "—"} hint="From PDFs" />
        <Stat compact={compact} label="Web Chunks" value={stats.webChunks ?? "—"} hint="From web" />
      </div>
    </section>
  );
}
