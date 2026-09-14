import { useState } from "react";
import Dashboard from "./components/Dashboard";
import DocumentList from "./components/DocumentList";
import KnowledgeBase from "./components/KnowledgeBase";
import Chat from "./components/Chat";

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow p-4">
        <h1 className="text-2xl font-bold">AI Offline Knowledge Assistant</h1>
        <p className="text-sm text-gray-500">Qwen3 + Chroma + SQLite — 100% offline</p>
      </header>
      <main className="max-w-5xl mx-auto p-4 space-y-4">
        <Dashboard key={refreshKey} />
        <DocumentList onUpdate={() => setRefreshKey((k) => k + 1)} />
        <KnowledgeBase />
        <Chat />
      </main>
    </div>
  );
}
