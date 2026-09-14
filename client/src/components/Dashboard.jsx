import { useEffect, useState } from "react";
import { getStats } from "../services/api";
export default function Dashboard() {
  const [stats, setStats] = useState(null);
  async function load() { try { const d = await getStats(); if (d.success) setStats(d.stats); } catch {} }
  useEffect(() => { load(); }, []);
  if (!stats) return <div className="p-4 text-sm text-gray-500">Loading stats...</div>;
  const items = [
    ["Documents", stats.total],
    ["Ready", stats.ready],
    ["Failed", stats.failed],
    ["Web Sources", `${stats.webSources ?? 0}/${stats.webTotal ?? 0}`],
    ["Total Chunks", stats.chunkCount],
    ["Doc Chunks", stats.docChunks ?? "—"],
    ["Web Chunks", stats.webChunks ?? "—"],
  ];
  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="font-semibold mb-2">Knowledge Base</h2>
      <div className="grid grid-cols-3 gap-3">
        {items.map(([label, val]) => (
          <div key={label} className="rounded border bg-gray-50 p-3 text-center">
            <div className="text-xs text-gray-500">{label}</div>
            <div className="text-xl font-bold">{val}</div>
          </div>
        ))}
      </div>
      <button onClick={load} className="mt-2 text-xs text-blue-600 underline">Refresh</button>
    </div>
  );
}
