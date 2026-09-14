import { useState } from "react";
import Dashboard from "./components/Dashboard";
import SystemStatus from "./components/SystemStatus";
import DocumentList from "./components/DocumentList";
import KnowledgeBase from "./components/KnowledgeBase";
import Chat from "./components/Chat";
export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow p-4">
        <h1 className="text-2xl font-bold">AI Offline Knowledge Assistant</h1>
        <p className="text-sm text-gray-500">Qwen3 + Chroma + SQLite — Q&A 100% offline · Internet only for Research</p>
      </header>
      <main className="max-w-5xl mx-auto p-4 space-y-4">
        <SystemStatus />
        <Dashboard key={refreshKey} />
        <DocumentList onUpdate={() => setRefreshKey((k) => k + 1)} />
        <KnowledgeBase />
        <Chat />
        <footer className="text-[11px] text-gray-500 text-center py-2">Architecture: React → Express → SQLite / ChromaDB / Ollama (Qwen3 + qwen3-embedding:0.6b) → RAG → Sources</footer>
      </main>
    </div>
  );
}
