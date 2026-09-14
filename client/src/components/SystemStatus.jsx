import { useEffect, useState } from "react";
import { checkHealth, checkOllama, checkChroma } from "../services/api";
export default function SystemStatus() {
  const [s, setS] = useState(null);
  const [ollama, setOllama] = useState(null);
  const [chroma, setChroma] = useState(null);
  async function load() {
    try { setS(await checkHealth()); } catch { setS({ backend: false }); }
    try { setOllama(await checkOllama()); } catch { setOllama({ available: false }); }
    try { setChroma(await checkChroma()); } catch { setChroma({ available: false }); }
  }
  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);
  const row = (ok, label, detail) => (
    <div className="flex justify-between text-sm py-1">
      <span>{ok ? "✓" : "✕"} {label}</span>
      <span className={ok ? "text-green-600" : "text-red-600"}>{ok ? "OK" : "Unavailable"}{detail ? ` — ${detail}` : ""}</span>
    </div>
  );
  if (!s) return <div className="p-3 text-sm text-gray-500">Checking system...</div>;
  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="font-semibold mb-2">System Status</h2>
      {row(true, "Backend", "")}
      {row(!!s.sqlite, "SQLite", "")}
      {row(!!chroma?.available, "ChromaDB", chroma?.count != null ? `${chroma.count} chunks` : chroma?.error?.slice(0,40))}
      {row(!!ollama?.available, "Ollama", ollama?.available ? `${ollama.llm}` : ollama?.error?.slice(0,40))}
      <div className="mt-2 flex gap-2 text-xs">
        <span className={`px-2 py-1 rounded ${s.ollama && s.chromadb ? "bg-green-100" : "bg-yellow-100"}`}>
          {s.ollama && s.chromadb ? "🟢 Local / Offline Mode" : "🌐 Internet Research Mode — Q&A still local"}
        </span>
        <button onClick={load} className="text-blue-600 underline">Refresh</button>
      </div>
    </div>
  );
}
