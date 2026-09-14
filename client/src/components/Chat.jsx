import { useEffect, useState } from "react";
import { sendChat, getHistory, listDocuments } from "../services/api";
export default function Chat() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [topK, setTopK] = useState(5);
  const [threshold, setThreshold] = useState("");
  const [sourceType, setSourceType] = useState("all");
  const [documentId, setDocumentId] = useState("");
  const [docs, setDocs] = useState([]);
  const [err, setErr] = useState("");
  async function loadHistory() { try { const d = await getHistory(); if (d.success) setHistory(d.history); } catch {} }
  async function loadDocs() { try { const d = await listDocuments(); if (d.success) setDocs(d.documents); } catch {} }
  useEffect(() => { loadHistory(); loadDocs(); }, []);
  async function handleSend(e) {
    e.preventDefault();
    if (!question.trim()) { setErr("Question is required"); return; }
    if (question.length > 5000) { setErr("Question too long"); return; }
    setLoading(true); setAnswer(null); setSources([]); setErr("");
    try {
      const filter = {};
      if (sourceType !== "all") filter.sourceType = sourceType;
      if (documentId) filter.documentId = documentId;
      const thr = threshold === "" ? null : parseFloat(threshold);
      const data = await sendChat(question, topK, { threshold: thr, filter });
      if (data.success) { setAnswer(data.answer); setSources(data.sources || []); loadHistory(); }
      else setErr(data.message || "Error");
    } catch (ex) { setErr(ex.message); }
    setLoading(false);
  }
  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="font-semibold mb-2">Chat with your documents</h2>
      <form onSubmit={handleSend} className="space-y-2 mb-3">
        <div className="flex gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSend(e); }} placeholder="Ask a question..." className="flex-1 border rounded px-3 py-1 text-sm" />
          <button type="submit" disabled={loading || !question.trim()} className="px-4 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50">{loading ? "Thinking..." : "Ask"}</button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs items-center">
          <select value={topK} onChange={(e) => setTopK(parseInt(e.target.value, 10))} className="border rounded px-2 py-1 bg-white">
            <option value={3}>Top-K 3</option>
            <option value={5}>Top-K 5</option>
            <option value={8}>Top-K 8</option>
            <option value={10}>Top-K 10</option>
          </select>
          <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Threshold e.g. 1.2" className="border rounded px-2 py-1 w-28" title="Cosine distance threshold (0-2, lower=stricter). Leave empty to disable." />
          <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="border rounded px-2 py-1 bg-white">
            <option value="all">All sources</option>
            <option value="document">📄 Documents only</option>
            <option value="web">🌐 Web only</option>
          </select>
          <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="border rounded px-2 py-1 bg-white max-w-[160px]">
            <option value="">All documents</option>
            {docs.map((d) => <option key={d.id} value={d.id}>{d.original_filename}</option>)}
          </select>
        </div>
      </form>
      <div className="text-[11px] text-gray-500 mb-2">Small K fast/less context. Large K slower/more noise. Threshold filters irrelevant chunks — tune experimentally (see docs).</div>
      {err && <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">{err}</div>}
      {!answer && !loading && !err && <div className="mb-2 p-3 bg-gray-50 rounded text-sm text-gray-500">Ask a question about your PDFs or researched web content. No knowledge? Upload a PDF first.</div>}
      {loading && <div className="mb-2 p-3 bg-blue-50 rounded text-sm animate-pulse">Retrieving context and generating answer...</div>}
      {answer && (
        <div className="mb-3 p-3 bg-gray-50 rounded text-sm">
          <div className="font-medium mb-1">Answer:</div>
          <div className="whitespace-pre-wrap">{answer}</div>
          {sources.length > 0 ? (
            <div className="mt-3 border-t pt-2">
              <div className="text-xs font-medium mb-1">Sources ({sources.length}):</div>
              <ul className="space-y-1">
                {sources.map((s, i) => (
                  <li key={s.id || i} className="text-xs bg-white border rounded px-2 py-1">
                    {s.type === "web" ? <span>🌐 <b>{s.title}</b> — {s.url} {s.distance != null ? `(dist ${Number(s.distance).toFixed(3)})` : ""}</span>
                      : <span>📄 <b>{s.filename}</b> — Page {s.page ?? "?"} chunk {s.chunkIndex ?? "?"} {s.distance != null ? `(dist ${Number(s.distance).toFixed(3)})` : ""}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ) : <div className="mt-2 text-xs text-gray-500">No sources — answer from insufficient context message.</div>}
        </div>
      )}
      <div className="text-xs">
        <div className="font-medium mb-1">History ({history.length})</div>
        <ul className="space-y-1 max-h-64 overflow-auto">
          {history.map((h) => <li key={h.id} className="border-b py-1"><div className="font-medium">Q: {h.question}</div><div className="text-gray-600 truncate">A: {String(h.answer).slice(0, 120)}</div></li>)}
          {history.length === 0 && <li className="text-gray-400">No history</li>}
        </ul>
      </div>
    </div>
  );
}
