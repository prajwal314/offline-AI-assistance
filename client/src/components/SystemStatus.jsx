import { useEffect, useState } from "react";
import { checkHealth, checkOllama, checkChroma } from "../services/api";

function Dot({ ok, checking }) {
  const c = checking ? "bg-amber-400" : ok ? "bg-emerald-500" : "bg-red-500";
  return <span className={`inline-block w-2 h-2 rounded-full ${c} ${ok && !checking ? "shadow-[0_0_0_3px_rgba(16,185,129,0.15)]" : ""}`} />;
}

function Card({ label, ok, checking, value, sub }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col gap-2.5 shadow-card">
      <div className="text-[11px] font-semibold tracking-widest uppercase text-gray-500">{label}</div>
      <div className="flex items-center gap-2">
        <Dot ok={ok} checking={checking} />
        <span className={`text-sm font-semibold ${checking ? "text-amber-600" : ok ? "text-emerald-700" : "text-red-600"}`}>
          {checking ? "Checking" : ok ? "Online" : "Offline"}
        </span>
      </div>
      <div className="text-[11px] text-gray-500 truncate">{sub || value || "—"}</div>
    </div>
  );
}

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

  if (!s) return <div className="bg-white border border-gray-200 rounded-xl p-6 text-sm text-gray-500 flex items-center gap-2"><span className="w-4 h-4 border-2 border-gray-300 border-t-indigo-600 rounded-full animate-spin" /> Checking system…</div>;

  const ollamaOk = !!ollama?.available;
  const chromaOk = !!chroma?.available;
  const backendOk = s.backend !== false;

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">System Status</h2>
          <p className="text-xs text-gray-500">Local services health — auto-refreshes every 10s</p>
        </div>
        <button onClick={load} className="text-xs font-medium text-indigo-600 hover:text-indigo-700 px-2 py-1 rounded-md hover:bg-indigo-50 transition">Refresh</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Backend" ok={backendOk} value="Express API" sub={backendOk ? "Operational" : "Unavailable"} />
        <Card label="SQLite" ok={!!s.sqlite} value="Metadata" sub={s.sqlite ? "Ready" : "Unavailable"} />
        <Card label="ChromaDB" ok={chromaOk} checking={chroma === null} value={chromaOk ? `${chroma.count} chunks` : chroma?.error?.slice(0,32) || "Unavailable"} sub={chromaOk ? "Vector store" : ""} />
        <Card label="Ollama" ok={ollamaOk} checking={ollama === null} value={ollamaOk ? ollama.llm || "qwen3:4b" : ollama?.error?.slice(0,32) || "Unavailable"} sub={ollamaOk ? "LLM ready" : ""} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${s.ollama && s.chromadb ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.ollama && s.chromadb ? "bg-emerald-500" : "bg-amber-500"}`} />
          {s.ollama && s.chromadb ? "Local / Offline Mode — Q&A ready" : "Internet Research Mode — Q&A still local"}
        </span>
        <span className="text-[11px] text-gray-400">Chroma {chromaOk ? "●" : "○"} Ollama {ollamaOk ? "●" : "○"}</span>
      </div>
    </section>
  );
}
