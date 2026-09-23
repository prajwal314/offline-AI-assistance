import { useEffect, useState } from "react";
import { getStats } from "../services/api";

function Stat({ label, value, hint }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-card">
      <div className="text-[11px] font-semibold tracking-widest uppercase text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{value}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  async function load() { try { const d = await getStats(); if (d.success) setStats(d.stats); } catch {} }
  useEffect(() => { load(); }, []);
  if (!stats) return <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500 flex items-center gap-2"><span className="w-4 h-4 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" />Loading knowledge base…</div>;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Knowledge Base</h2>
          <p className="text-xs text-gray-500">Overview of your indexed knowledge</p>
        </div>
        <button onClick={load} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-md hover:bg-indigo-50 transition">Refresh</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Stat label="Documents" value={stats.total} hint={`${stats.ready ?? 0} ready`} />
        <Stat label="Ready" value={stats.ready} hint={`${stats.failed ?? 0} failed`} />
        <Stat label="Web Sources" value={stats.webSources ?? 0} hint={`${stats.webTotal ?? 0} total`} />
        <Stat label="Total Chunks" value={stats.chunkCount ?? 0} hint="Knowledge" />
        <Stat label="Document Chunks" value={stats.docChunks ?? "—"} hint="From PDFs" />
        <Stat label="Web Chunks" value={stats.webChunks ?? "—"} hint="From web" />
      </div>
    </section>
  );
}
