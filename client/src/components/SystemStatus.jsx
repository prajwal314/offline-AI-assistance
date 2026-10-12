import { useEffect, useState } from "react";
import { checkHealth, checkOllama, checkChroma } from "../services/api";

function StatusItem({ label, ok, checking, title }) {
  const dot = checking
    ? "bg-amber-400 animate-pulse"
    : ok
      ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]"
      : "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.15)]";
  const text = checking ? "text-amber-600 dark:text-amber-400" : ok ? "text-gray-700 dark:text-gray-300" : "text-red-600 dark:text-red-400";
  return (
    <span title={title} className="inline-flex items-center gap-1.5 cursor-default">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />
      <span className={`text-[11px] font-medium ${text}`}>{label}</span>
    </span>
  );
}

function Divider() {
  return <span className="w-px h-3.5 bg-gray-200 dark:bg-gray-700 shrink-0" />;
}

// Navbar-integrated system status — single strip, no boxes.
export default function SystemStatus() {
  const [s, setS] = useState(null);
  const [ollama, setOllama] = useState(null);
  const [chroma, setChroma] = useState(null);
  const [spinning, setSpinning] = useState(false);

  async function load() {
    setSpinning(true);
    try { setS(await checkHealth()); } catch { setS({ backend: false }); }
    try { setOllama(await checkOllama()); } catch { setOllama({ available: false }); }
    try { setChroma(await checkChroma()); } catch { setChroma({ available: false }); }
    setSpinning(false);
  }

  useEffect(() => { load(); const id = setInterval(load, 10000); return () => clearInterval(id); }, []);

  if (!s) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-gray-400 dark:text-gray-500">
        <span className="w-3 h-3 border-2 border-gray-200 dark:border-gray-700 border-t-indigo-500 rounded-full animate-spin" />
        <span className="hidden sm:inline">Checking…</span>
      </div>
    );
  }

  const ollamaOk = !!ollama?.available;
  const chromaOk = !!chroma?.available;
  const backendOk = s.backend !== false;
  const sqliteOk = !!s.sqlite;
  const allOk = backendOk && sqliteOk && chromaOk && ollamaOk;

  return (
    <div className="flex items-center gap-2 min-w-0">
      {/* Service dots — one clean strip instead of 4 boxes */}
      <div className="hidden md:flex items-center gap-2.5 pl-3 pr-2.5 py-1 rounded-full bg-gray-50/80 dark:bg-gray-800/70 border border-gray-200 dark:border-gray-700">
        <StatusItem
          label="API"
          ok={backendOk}
          title={backendOk ? "Backend operational" : "Backend unavailable"}
        />
        <Divider />
        <StatusItem
          label="SQLite"
          ok={sqliteOk}
          title={sqliteOk ? "Metadata DB ready" : "SQLite unavailable"}
        />
        <Divider />
        <StatusItem
          label="Chroma"
          ok={chromaOk}
          checking={chroma === null}
          title={chromaOk ? `${chroma.count} vectors indexed` : chroma?.error || "ChromaDB unavailable"}
        />
        <Divider />
        <StatusItem
          label="Ollama"
          ok={ollamaOk}
          checking={ollama === null}
          title={ollamaOk ? `LLM ready (${ollama.llm || "qwen3:4b"})` : ollama?.error || "Ollama unavailable"}
        />
        <button
          onClick={load}
          title="Refresh status"
          className="ml-0.5 w-5 h-5 inline-flex items-center justify-center rounded-full text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-300 hover:bg-white dark:hover:bg-gray-700 border border-transparent hover:border-gray-200 dark:hover:border-gray-600 transition"
        >
          <span className={`text-[12px] leading-none inline-block ${spinning ? "animate-spin" : ""}`}>↻</span>
        </button>
      </div>

      {/* Mobile fallback: dots only */}
      <div className="flex md:hidden items-center gap-1.5 px-2 py-1 rounded-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
        {[backendOk, sqliteOk, chromaOk, ollamaOk].map((ok, i) => (
          <span key={i} className={`w-1.5 h-1.5 rounded-full ${ok ? "bg-emerald-500" : "bg-red-500"}`} />
        ))}
      </div>

      {/* Overall mode pill */}
      <span
        title={allOk ? "All local services online — Q&A ready" : "Some services offline — Q&A still local"}
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-medium border whitespace-nowrap ${
          allOk
            ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300"
            : "bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"
        }`}
      >
        <span className={`w-1.5 h-1.5 rounded-full ${allOk ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
        {allOk ? "All Ready" : "Degraded"}
      </span>
    </div>
  );
}
