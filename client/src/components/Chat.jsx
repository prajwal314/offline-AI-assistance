import { useEffect, useRef, useState } from "react";
import { streamChat, listSessions, getSessionMessages, renameSession, deleteSession, listDocuments } from "../services/api";
import { clamp } from "./Resizable";

// Fallback splitter for any answer text that still carries
// Qwen3-style <think>...</think> blocks (e.g. legacy rows).
function splitThinking(text) {
  if (!text) return { thinking: "", answer: "" };
  let thinking = "";
  const re = /<think>([\s\S]*?)<\/think>/gi;
  let m;
  while ((m = re.exec(text)) !== null) thinking += (thinking ? "\n\n" : "") + m[1].trim();
  let answer = String(text).replace(re, "").trim();
  if (!thinking && /<\/think>/i.test(answer)) {
    const idx = answer.toLowerCase().lastIndexOf("</think>");
    thinking = answer.slice(0, idx).replace(/<think>/gi, "").trim();
    answer = answer.slice(idx + 8).trim();
  }
  const openIdx = answer.toLowerCase().lastIndexOf("<think>");
  if (openIdx !== -1) {
    thinking += (thinking ? "\n\n" : "") + answer.slice(openIdx + 7).trim();
    answer = answer.slice(0, openIdx).trim();
  }
  answer = answer.replace(/<\/?think>/gi, "").trim();
  return { thinking: thinking.trim(), answer };
}

function normalizeMessage(m) {
  const fallback = splitThinking(m.answer || "");
  const thinking = [m.thinking || "", fallback.thinking].filter(Boolean).join("\n\n").trim();
  return { ...m, answer: fallback.answer, thinking, sources: normalizeSources(m.sources) };
}

function normalizeSources(rawSources) {
  if (!Array.isArray(rawSources)) return [];
  return rawSources.map((s, i) => {
    if (!s.metadata && (s.filename || s.title || s.type)) return s;
    const m = s.metadata || {};
    if (m.sourceType === "web") {
      return { type: "web", title: m.title || "Web", url: m.url || "", topic: m.topic || null, chunkIndex: m.chunkIndex ?? null, distance: s.distance ?? null, id: s.id || i };
    }
    return { type: "document", filename: m.filename || "document", page: m.pageNumber ?? m.page ?? null, chunkIndex: m.chunkIndex ?? null, documentId: m.documentId || null, distance: s.distance ?? null, id: s.id || i };
  });
}

function AnswerWithThinking({ answer, thinking }) {
  const [expanded, setExpanded] = useState(false);
  const clean = answer || "";
  return (
    <div>
      {thinking ? (
        <div className="mb-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-500 dark:text-gray-400 px-2 py-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200 transition"
            title={expanded ? "Hide model thinking" : "Show model thinking"}
          >
            <span className="text-[10px]">{expanded ? "▾" : "▸"}</span>
            {expanded ? "Hide thinking" : "Show thinking"}
          </button>
          {expanded && (
            <div className="mt-2 max-h-[220px] overflow-auto rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400 italic whitespace-pre-wrap">
              {thinking}
            </div>
          )}
        </div>
      ) : null}
      <div className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{clean}</div>
    </div>
  );
}

function Sources({ sources }) {  if (!sources || sources.length === 0) {
    return <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">No sources — answer generated from insufficient context.</div>;
  }
  return (
    <div className="pt-3 mt-4 border-t border-gray-200 dark:border-gray-700">
      <div className="mb-2 text-xs font-semibold text-gray-700 dark:text-gray-300">Sources ({sources.length})</div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {sources.map((s, i) => (
          <li key={s.id || i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-3 py-2.5">
            <div className="flex items-start gap-2">
              <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[11px] shrink-0 border ${s.type === "web" ? "bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800" : "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800"}`}>{s.type === "web" ? "🌐" : "📄"}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{s.type === "web" ? s.title : s.filename}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{s.type === "web" ? (s.url || "").slice(0, 48) : `Page ${s.page ?? "?"} · chunk ${s.chunkIndex ?? "?"}`}</div>
              </div>
              {s.distance != null && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 shrink-0">dist {Number(s.distance).toFixed(3)}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Chat({ compact = false }) {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState("");
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [streamingSources, setStreamingSources] = useState([]);
  const [err, setErr] = useState("");

  const [topK, setTopK] = useState(5);
  const [threshold, setThreshold] = useState("");
  const [sourceType, setSourceType] = useState("all");
  const [documentId, setDocumentId] = useState("");
  const [docs, setDocs] = useState([]);
  const [showSettings, setShowSettings] = useState(false);

  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sideW, setSideW] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem("chat-side-w"), 10);
      if (!Number.isNaN(v)) return clamp(v, 140, 320);
    } catch {}
    return compact ? 180 : 240;
  });
  useEffect(() => { try { localStorage.setItem("chat-side-w", String(sideW)); } catch {} }, [sideW]);

  function onSideDrag(e) {
    e.preventDefault();
    let lastX = e.clientX;
    const move = (ev) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      setSideW((w) => clamp(w + dx, 140, 320));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const threadRef = useRef(null);
  const firstLoad = useRef(true);

  async function loadDocs() { try { const d = await listDocuments(); if (d.success) setDocs(d.documents); } catch {} }

  async function loadSessions(selectId = undefined) {
    try {
      const d = await listSessions();
      if (!d.success) return;
      setSessions(d.sessions || []);
      if (selectId !== undefined) {
        setActiveSessionId(selectId);
        return;
      }
      // On very first load, resume the most recent session so context is there
      if (firstLoad.current && (d.sessions || []).length > 0 && activeSessionId == null) {
        firstLoad.current = false;
        setActiveSessionId(d.sessions[0].id);
        return;
      }
      firstLoad.current = false;
    } catch {}
  }

  async function loadMessages(sessionId) {
    if (!sessionId) { setMessages([]); return; }
    setMessagesLoading(true);
    try {
      const d = await getSessionMessages(sessionId);
      if (d.success) {
        setMessages((d.messages || []).map(normalizeMessage));
      }
    } catch {}
    setMessagesLoading(false);
  }

  useEffect(() => { loadDocs(); loadSessions(); }, []);
  useEffect(() => { loadMessages(activeSessionId); }, [activeSessionId]);

  // Auto-scroll thread to bottom on new content
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingAnswer, streamingThinking, pendingQuestion, messagesLoading]);

  function handleNewChat() {
    if (loading) return;
    setActiveSessionId(null);
    setMessages([]);
    setPendingQuestion("");
    setStreamingAnswer("");
    setStreamingThinking("");
    setStreamingSources([]);
    setErr("");
    setQuestion("");
    // Refresh list so counts/titles are current, but stay on the blank new chat
    loadSessions(null);
  }

  function handleSelectSession(id) {
    if (loading || id === activeSessionId) return;
    setErr("");
    setPendingQuestion("");
    setStreamingAnswer("");
    setStreamingThinking("");
    setStreamingSources([]);
    setQuestion("");
    setActiveSessionId(id);
  }

  async function handleDeleteSession(id) {
    if (loading) return;
    if (!window.confirm("Delete this session and all its chats?")) return;
    try {
      const d = await deleteSession(id);
      if (d.success) {
        if (id === activeSessionId) {
          setActiveSessionId(null);
          setMessages([]);
        }
        loadSessions(id === activeSessionId ? null : undefined);
        if (id === activeSessionId) setMessages([]);
      }
    } catch (e) { setErr(e.message); }
  }

  function startRename(s) {
    setEditingId(s.id);
    setEditTitle(s.title || "");
  }

  async function saveRename(id) {
    const t = editTitle.trim();
    if (!t) { setEditingId(null); return; }
    try {
      const d = await renameSession(id, t);
      if (d.success) loadSessions(undefined);
    } catch (e) { setErr(e.message); }
    setEditingId(null);
  }

  async function handleSend(e) {
    e?.preventDefault();
    if (!question.trim()) { setErr("Question is required"); return; }
    if (question.length > 5000) { setErr("Question too long"); return; }
    const q = question.trim();
    const targetSessionId = activeSessionId;
    setLoading(true); setErr("");
    setPendingQuestion(q);
    setStreamingAnswer("");
    setStreamingThinking("");
    setStreamingSources([]);
    setQuestion("");
    try {
      const filter = {};
      if (sourceType !== "all") filter.sourceType = sourceType;
      if (documentId) filter.documentId = documentId;
      const thr = threshold === "" ? null : parseFloat(threshold);
      let finalSessionId = targetSessionId;
      await streamChat(q, topK, { threshold: thr, filter, sessionId: targetSessionId }, (event) => {
        if (event.type === "meta") {
          setStreamingSources(event.sources || []);
          if (event.sessionId) finalSessionId = event.sessionId;
          return;
        }
        if (event.type === "token") {
          setStreamingAnswer((current) => (current || "") + event.token);
          return;
        }
        if (event.type === "thinking") {
          setStreamingThinking((current) => (current || "") + event.token);
          return;
        }
        if (event.type === "done") {
          const doneSources = normalizeSources(event.sources || []);
          const fallback = splitThinking(event.answer || "");
          const doneThinking = [event.thinking || "", fallback.thinking].filter(Boolean).join("\n\n").trim();
          const doneAnswer = fallback.answer;
          if (event.sessionId) finalSessionId = event.sessionId;
          setMessages((prev) => [...prev, { id: `tmp-${Date.now()}`, question: q, answer: doneAnswer, thinking: doneThinking, sources: doneSources, created_at: new Date().toISOString() }]);
          setPendingQuestion("");
          setStreamingAnswer("");
          setStreamingThinking("");
          setStreamingSources([]);
          // Refresh sidebar (new title / ordering) and adopt the session id for brand-new chats
          loadSessions(finalSessionId);
          if (finalSessionId) {
            // Re-fetch canonical messages so ids/timestamps match the DB (keeps context consistent)
            getSessionMessages(finalSessionId).then((d) => {
              if (d.success) setMessages((d.messages || []).map(normalizeMessage));
            }).catch(() => {});
          }
          return;
        }
        if (event.type === "error") setErr(event.message || "Error generating answer");
      });
    } catch (ex) {
      setErr(ex.message);
      // Restore the question so the user doesn't lose it
      setQuestion(q);
      setPendingQuestion("");
      setStreamingAnswer("");
      setStreamingThinking("");
    }
    setLoading(false);
  }

  const filteredSessions = sessions.filter((s) =>
    !search.trim() || (s.title || "").toLowerCase().includes(search.trim().toLowerCase())
  );
  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const streaming = loading && (pendingQuestion || streamingAnswer || streamingThinking);

  return (
    <section className="overflow-hidden bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl shadow-card flex flex-col min-h-0 h-full">
      <div className={`${compact ? "px-3 pt-2.5 pb-2" : "px-5 pt-5 pb-3"} border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2 shrink-0`}>
        <div className="min-w-0">
          <h2 className={`${compact ? "text-[13px]" : "text-sm"} font-semibold text-gray-900 dark:text-gray-100`}>AI Knowledge Assistant</h2>
          {!compact && <p className="text-xs text-gray-500 dark:text-gray-400">Ask questions about your documents and researched knowledge — RAG answers with sources</p>}
          {compact && <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">RAG answers with sources · context preserved</p>}
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen((v) => !v)}
          className="md:hidden text-xs font-medium text-indigo-600 dark:text-indigo-300 px-2 py-1 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-900/30 shrink-0"
        >
          {sidebarOpen ? "Hide chats" : "Show chats"}
        </button>
      </div>

      <div className={`flex flex-col md:flex-row flex-1 min-h-0 ${compact ? "" : "min-h-[560px] max-h-[760px]"}`}>
        {/* ---- Left: sessions (ChatGPT-style, resizable) ---- */}
        {(sidebarOpen) && (
          <>
          <aside style={{ width: sideW }} className={`w-full shrink-0 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/40 flex-col hidden md:flex min-h-0`}>
            <div className="p-3 space-y-2">
              <button
                type="button"
                onClick={handleNewChat}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition disabled:opacity-40"
                disabled={loading}
              >
                <span className="text-base leading-none">+</span> New chat
              </button>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search chats..."
                className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-3 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500">
              Sessions · {sessions.length}
            </div>
            <div className="flex-1 overflow-auto px-2 pb-3 space-y-1">
              <button
                type="button"
                onClick={handleNewChat}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-xs transition ${activeSessionId == null ? "bg-white dark:bg-gray-800 border border-indigo-200 dark:border-indigo-700 shadow-sm" : "hover:bg-white dark:hover:bg-gray-800 border border-transparent"}`}
              >
                <div className="font-medium text-gray-900 dark:text-gray-100 truncate">New chat</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">Start a fresh session</div>
              </button>
              {filteredSessions.length === 0 && (
                <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500">
                  {sessions.length === 0 ? "No sessions yet — ask something to start your first one." : "No sessions match your search."}
                </div>
              )}
              {filteredSessions.map((s) => {
                const isActive = s.id === activeSessionId;
                return (
                  <div
                    key={s.id}
                    onClick={() => handleSelectSession(s.id)}
                    className={`group px-3 py-2.5 rounded-xl cursor-pointer border transition ${isActive ? "bg-white dark:bg-gray-800 border-indigo-200 dark:border-indigo-700 shadow-sm" : "border-transparent hover:bg-white dark:hover:bg-gray-800"}`}
                    title={s.title}
                  >
                    {editingId === s.id ? (
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveRename(s.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => saveRename(s.id)}
                        className="w-full border border-indigo-300 dark:border-indigo-700 rounded-lg px-2 py-1 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none"
                      />
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate flex-1">{s.title || "Untitled"}</div>
                          <div className="hidden group-hover:flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                            <button type="button" onClick={() => startRename(s)} className="text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-300 text-xs px-1" title="Rename">✎</button>
                            <button type="button" onClick={() => handleDeleteSession(s.id)} className="text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 text-xs px-1" title="Delete">🗑</button>
                          </div>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                          <span>{s.message_count ?? 0} msgs</span>
                          <span>·</span>
                          <span className="truncate">{s.updated_at ? new Date(s.updated_at).toLocaleString() : ""}</span>
                        </div>
                        {s.last_question && <div className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{s.last_question}</div>}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>
          <div
            onPointerDown={onSideDrag}
            onDoubleClick={() => setSideW(compact ? 180 : 240)}
            title="Drag to resize sessions · double-click to reset"
            className="hidden md:flex shrink-0 w-3 -mx-0.5 cursor-col-resize items-center justify-center group touch-none self-stretch z-10"
          >
            <div className="w-[3px] h-12 rounded-full bg-gray-200 dark:bg-gray-700 group-hover:bg-indigo-400 transition" />
          </div>
          </>
        )}

        {/* ---- Mobile sessions dropdown ---- */}
        <div className="md:hidden">
          {sidebarOpen && (
            <div className="border-b border-gray-100 dark:border-gray-800 p-3 bg-gray-50/60 dark:bg-gray-800/40">
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={handleNewChat} className="flex-1 px-3 py-2 rounded-xl bg-indigo-600 text-white text-sm font-medium">+ New chat</button>
              </div>
              <select
                value={activeSessionId ?? ""}
                onChange={(e) => e.target.value === "" ? handleNewChat() : handleSelectSession(Number(e.target.value))}
                className="w-full border border-gray-300 dark:border-gray-700 rounded-xl px-2 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              >
                <option value="">New chat</option>
                {sessions.map((s) => <option key={s.id} value={s.id}>{(s.title || "Untitled").slice(0, 60)} ({s.message_count ?? 0})</option>)}
              </select>
            </div>
          )}
        </div>

        {/* ---- Right: continuous thread ---- */}
        <div className="flex-1 flex flex-col min-w-0 min-h-0">
          <div className={`${compact ? "px-3 pt-2 pb-1.5" : "px-4 pt-3 pb-2"} border-b border-gray-100 dark:border-gray-800 flex items-center justify-between gap-2 shrink-0`}>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{activeSession ? activeSession.title : "New chat"}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {activeSessionId ? `${messages.length} message${messages.length === 1 ? "" : "s"} in this session · context preserved` : "Context will be saved as a session once you send your first message"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="text-xs font-medium text-gray-600 dark:text-gray-300 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 shrink-0"
            >
              {showSettings ? "Hide retrieval" : "Retrieval"}
            </button>
          </div>

          {showSettings && (
            <div className="m-3 mb-0 p-3 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/60 dark:bg-gray-800/40">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Top-K</span>
                  <select value={topK} onChange={(e) => setTopK(parseInt(e.target.value, 10))} className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-2.5 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500">
                    <option value={3}>3</option><option value={5}>5</option><option value={8}>8</option><option value={10}>10</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Threshold</span>
                  <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="e.g. 1.2" className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-2.5 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:border-indigo-500" title="Cosine distance threshold (0-2, lower=stricter)" />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Source</span>
                  <select value={sourceType} onChange={(e) => setSourceType(e.target.value)} className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-2.5 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500">
                    <option value="all">All sources</option>
                    <option value="document">Documents only</option>
                    <option value="web">Web only</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">Document</span>
                  <select value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="w-full border border-gray-300 dark:border-gray-700 rounded-lg px-2.5 py-2 text-xs bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 truncate">
                    <option value="">All documents</option>
                    {docs.map((d) => <option key={d.id} value={d.id}>{d.original_filename}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          <div ref={threadRef} className={`flex-1 min-h-0 overflow-auto ${compact ? "p-3 space-y-3" : "p-4 space-y-4"}`}>
            {err && <div className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/30 px-3 py-2.5 text-sm text-red-700 dark:text-red-300 flex items-start gap-2"><span className="mt-0.5">⚠</span><span>{err}</span></div>}

            {messagesLoading && (
              <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-500 dark:text-gray-400"><span className="w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-indigo-600 rounded-full animate-spin" />Loading session…</div>
            )}

            {!messagesLoading && messages.length === 0 && !streaming && (
              <div className="px-6 py-10 text-center border border-gray-200 dark:border-gray-700 border-dashed rounded-xl bg-gray-50/50 dark:bg-gray-800/30">
                <div className="flex items-center justify-center w-10 h-10 mx-auto text-indigo-600 dark:text-indigo-300 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full">✦</div>
                <div className="mt-3 text-sm font-semibold text-gray-900 dark:text-gray-100">{activeSessionId ? "Continue this session" : "Start a new session"}</div>
                <div className="max-w-md mx-auto mt-1 text-xs text-gray-500 dark:text-gray-400">Ask questions about your uploaded PDFs or researched web knowledge. Follow-ups stay in this session — the assistant remembers previous turns.</div>
                <div className="mt-3 inline-flex px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300">“What are the main points in this document?”</div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className="space-y-3">
                <div className="flex justify-end">
                  <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm shadow-sm whitespace-pre-wrap">{m.question}</div>
                </div>
                <div className="px-4 py-4 border border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50 dark:bg-gray-800/60">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300"><span className="flex items-center justify-center w-6 h-6 text-indigo-600 dark:text-indigo-300 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full">✦</span> Assistant</div>
                    {m.created_at && <div className="text-[10px] text-gray-400 dark:text-gray-500">{new Date(m.created_at).toLocaleString()}</div>}
                  </div>
                  <div className="mt-2"><AnswerWithThinking answer={m.answer} thinking={m.thinking} /></div>
                  <Sources sources={m.sources} />
                </div>
              </div>
            ))}

            {streaming && (
              <div className="space-y-3">
                {pendingQuestion && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] bg-indigo-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-sm shadow-sm whitespace-pre-wrap">{pendingQuestion}</div>
                  </div>
                )}
                <div className="px-4 py-4 border border-indigo-100 dark:border-indigo-800 rounded-xl bg-indigo-50/50 dark:bg-indigo-900/20">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-700 dark:text-gray-300"><span className="w-4 h-4 border-2 border-indigo-200 dark:border-indigo-700 rounded-full border-t-indigo-600 animate-spin shrink-0" /> Assistant is answering…</div>
                  <div className="mt-2"><AnswerWithThinking answer={streamingAnswer} thinking={streamingThinking} /></div>
                  {streamingSources.length > 0 && <Sources sources={streamingSources} />}
                </div>
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="p-3 border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={activeSessionId ? "Continue this session..." : "Ask something to start a new session..."}
                className="flex-1 border border-gray-300 dark:border-gray-700 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white dark:bg-gray-800"
              />
              <button type="submit" disabled={loading || !question.trim()} className="flex items-center justify-center text-white transition bg-indigo-600 shadow-sm shrink-0 w-11 h-11 rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                <span className="text-base leading-none">↑</span>
              </button>
            </div>
            <div className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
              {activeSessionId ? "Chatting in this session — history is used as context." : "A new session will be created on send and appear on the left."}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
