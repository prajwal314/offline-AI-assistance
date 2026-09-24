import { useEffect, useState } from "react";
import { streamChat, getHistory, listDocuments } from "../services/api";

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
  const [asked, setAsked] = useState("");

  async function loadHistory() { try { const d = await getHistory(); if (d.success) setHistory(d.history); } catch {} }
  async function loadDocs() { try { const d = await listDocuments(); if (d.success) setDocs(d.documents); } catch {} }
  useEffect(() => { loadHistory(); loadDocs(); }, []);

  async function handleSend(e) {
    e.preventDefault();
    if (!question.trim()) { setErr("Question is required"); return; }
    if (question.length > 5000) { setErr("Question too long"); return; }
    const q = question.trim();
    setLoading(true); setAnswer(null); setSources([]); setErr(""); setAsked(q);
    try {
      const filter = {};
      if (sourceType !== "all") filter.sourceType = sourceType;
      if (documentId) filter.documentId = documentId;
      const thr = threshold === "" ? null : parseFloat(threshold);
      await streamChat(q, topK, { threshold: thr, filter }, (event) => {
        if (event.type === "meta") {
          setSources(event.sources || []);
          return;
        }
        if (event.type === "token") {
          setAnswer((current) => (current || "") + event.token);
          return;
        }
        if (event.type === "done") {
          setAnswer(event.answer || "");
          setSources(event.sources || []);
          loadHistory();
          return;
        }
        if (event.type === "error") setErr(event.message || "Error generating answer");
      });
    } catch (ex) { setErr(ex.message); }
    setLoading(false);
  }

  return (
    <section className="overflow-hidden bg-white border border-gray-200 rounded-xl shadow-card">
      <div className="px-5 pt-5 pb-3 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">AI Knowledge Assistant</h2>
        <p className="text-xs text-gray-500">Ask questions about your documents and researched knowledge — RAG answers with sources</p>
      </div>

      <div className="p-5 space-y-4">
        <form onSubmit={handleSend} className="space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSend(e); }}
                placeholder="Ask a question about your knowledge base..."
                className="w-full border border-gray-300 rounded-xl pl-3.5 pr-3 py-2.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
              />
            </div>
            <button type="submit" disabled={loading || !question.trim()} className="flex items-center justify-center text-white transition bg-indigo-600 shadow-sm shrink-0 w-11 h-11 rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
              <span className="text-base leading-none">↑</span>
            </button>
          </div>

          <div className="p-3 border border-gray-200 rounded-xl bg-gray-50/60">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-700">Retrieval Settings</span>
              <span className="text-[11px] text-gray-500 hidden sm:inline">Controls how much context is retrieved before generating an answer</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-gray-600">Top-K</span>
                <select value={topK} onChange={(e) => setTopK(parseInt(e.target.value, 10))} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-xs bg-white focus:outline-none focus:border-indigo-500">
                  <option value={3}>3</option><option value={5}>5</option><option value={8}>8</option><option value={10}>10</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-gray-600">Threshold</span>
                <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="e.g. 1.2" className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-xs bg-white focus:outline-none focus:border-indigo-500" title="Cosine distance threshold (0-2, lower=stricter)" />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-gray-600">Source</span>
                <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-xs bg-white focus:outline-none focus:border-indigo-500">
                  <option value="all">All sources</option>
                  <option value="document">Documents only</option>
                  <option value="web">Web only</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-medium text-gray-600">Document</span>
                <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-xs bg-white focus:outline-none focus:border-indigo-500 truncate">
                  <option value="">All documents</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.original_filename}</option>)}
                </select>
              </label>
            </div>
            <div className="text-[11px] text-gray-500 mt-2">Small K = faster / less context · Large K = slower / more noise · Threshold filters irrelevant chunks</div>
          </div>
        </form>

        {err && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 flex items-start gap-2"><span className="mt-0.5">⚠</span><span>{err}</span></div>}

        {!answer && !loading && !err && (
          <div className="px-6 py-10 text-center border border-gray-200 border-dashed rounded-xl bg-gray-50/50">
            <div className="flex items-center justify-center w-10 h-10 mx-auto text-indigo-600 bg-white border border-gray-200 rounded-full">✦</div>
            <div className="mt-3 text-sm font-semibold text-gray-900">Ask your knowledge base</div>
            <div className="max-w-md mx-auto mt-1 text-xs text-gray-500">Ask questions about your uploaded PDFs or researched web knowledge. Answers are generated offline via RAG — sources are cited below.</div>
            <div className="mt-3 inline-flex px-3 py-1.5 rounded-full bg-white border border-gray-200 text-xs text-gray-600">“What are the main points in this document?”</div>
          </div>
        )}

        {loading && <div className="flex items-center gap-2 px-4 py-3 text-sm text-indigo-700 border border-indigo-100 rounded-xl bg-indigo-50"><span className="w-4 h-4 border-2 border-indigo-200 rounded-full border-t-indigo-600 animate-spin shrink-0" />Retrieving context and generating answer…</div>}

        {answer && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm shadow-sm">{asked}</div>
            </div>
            <div className="px-4 py-4 border border-gray-200 rounded-xl bg-gray-50">
              <div className="flex items-center gap-2 text-xs font-semibold text-gray-700"><span className="flex items-center justify-center w-6 h-6 text-indigo-600 bg-white border border-gray-200 rounded-full">✦</span> Assistant</div>
              <div className="mt-2 text-sm leading-relaxed text-gray-800 whitespace-pre-wrap">{answer}</div>
              {sources.length > 0 ? (
                <div className="pt-3 mt-4 border-t border-gray-200">
                  <div className="mb-2 text-xs font-semibold text-gray-700">Sources ({sources.length})</div>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {sources.map((s, i) => (
                      <li key={s.id || i} className="bg-white border border-gray-200 rounded-xl px-3 py-2.5">
                        <div className="flex items-start gap-2">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] shrink-0 border ${s.type === "web" ? "bg-amber-50 border-amber-200" : "bg-indigo-50 border-indigo-200"}`}>{s.type === "web" ? "🌐" : "📄"}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-medium text-gray-900 truncate">{s.type === "web" ? s.title : s.filename}</div>
                            <div className="text-[11px] text-gray-500 truncate">{s.type === "web" ? (s.url || "").slice(0, 48) : `Page ${s.page ?? "?"} · chunk ${s.chunkIndex ?? "?"}`}</div>
                          </div>
                          {s.distance != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-gray-600 shrink-0">dist {Number(s.distance).toFixed(3)}</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : <div className="mt-3 text-xs text-gray-500">No sources — answer generated from insufficient context.</div>}
            </div>
          </div>
        )}

        <div className="pt-4 border-t border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700">Recent Questions</span>
            <span className="text-[11px] text-gray-500">{history.length} total</span>
          </div>
          {history.length === 0 ? (
            <div className="py-2 text-xs text-gray-400">No questions yet — your chat history will appear here.</div>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden max-h-[280px] overflow-auto bg-white">
              {history.map((h) => (
                <li key={h.id} className="px-3 py-2.5 hover:bg-gray-50 cursor-pointer transition" onClick={() => setQuestion(h.question)} title="Click to reuse question">
                  <div className="text-xs font-medium text-gray-900 truncate">Q: {h.question}</div>
                  <div className="text-[11px] text-gray-500 truncate">A: {String(h.answer).slice(0, 120)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
