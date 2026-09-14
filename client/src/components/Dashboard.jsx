import { useEffect, useState } from "react";
import { getStats } from "../services/api";

export default function Dashboard() {
  const [stats, setStats] = useState(null);

  async function load() {
    try {
      const data = await getStats();
      if (data.success) setStats(data.stats);
    } catch {}
  }

  useEffect(() => { load(); }, []);

  if (!stats) return <div className="p-4 text-sm text-gray-500">Loading stats...</div>;

  const items = [
    ["Total Docs", stats.total],
    ["Ready", stats.ready],
    ["Failed", stats.failed],
    ["Processing", stats.processing],
    ["Chunks", stats.chunkCount],
  ];

  return (
    <div className="grid grid-cols-3 gap-3 p-4">
      {items.map(([label, val]) => (
        <div key={label} className="rounded border bg-white p-3 text-center shadow-sm">
          <div className="text-xs text-gray-500">{label}</div>
          <div className="text-xl font-bold">{val}</div>
        </div>
      ))}
      <button onClick={load} className="col-span-3 text-xs text-blue-600 underline">Refresh</button>
    </div>
  );
}
