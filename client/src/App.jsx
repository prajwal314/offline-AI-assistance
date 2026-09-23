import { useState } from "react";
import Dashboard from "./components/Dashboard";
import SystemStatus from "./components/SystemStatus";
import DocumentList from "./components/DocumentList";
import KnowledgeBase from "./components/KnowledgeBase";
import Chat from "./components/Chat";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="min-h-screen bg-[#f8f9fb]">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 h-[64px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-[13px] font-bold">◉</div>
            <div className="leading-none">
              <div className="text-[15px] font-semibold tracking-tight text-gray-900">AI Knowledge Assistant</div>
              <div className="text-[11px] font-medium text-gray-500 tracking-wide">Offline RAG Knowledge Platform</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-[11px] text-gray-500">
              <span className="hidden lg:inline">Qwen3 · Chroma · SQLite</span>
              <span className="w-px h-3 bg-gray-200 hidden lg:block" />
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 border border-green-200 text-xs font-medium text-green-700">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /> Local Mode
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <SystemStatus />
        <Dashboard key={refreshKey} />
        <DocumentList onUpdate={() => setRefreshKey((k) => k + 1)} />
        <KnowledgeBase />
        <Chat />
        <footer className="pt-2 pb-4 text-center text-[11px] leading-relaxed text-gray-400">
          Architecture: React → Express → SQLite / ChromaDB / Ollama (Qwen3 + qwen3-embedding) → RAG → Sources<br />
          <span className="text-gray-400">Q&A 100% offline · Internet only for Research</span>
        </footer>
      </main>
    </div>
  );
}
