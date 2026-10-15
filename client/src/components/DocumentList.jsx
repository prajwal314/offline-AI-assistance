import { useEffect, useState } from "react";
import { listDocuments, deleteDocument, uploadDocument } from "../services/api";

function Badge({ status }) {
  const m = {
    ready: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    processing: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    failed: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${m[status] || "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700"}`}>{status}</span>;
}

export default function DocumentList({ onUpdate, compact = false }) {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [showMeta, setShowMeta] = useState(false);
  const [version, setVersion] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [docStatus, setDocStatus] = useState("active");
  async function load() { const data = await listDocuments(); if (data.success) setDocs(data.documents); if (onUpdate) onUpdate(); }
  useEffect(() => { load(); }, []);
  async function handleUpload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { setMsg("Only PDF files are allowed"); return; }
    if (file.size > 20 * 1024 * 1024) { setMsg("File too large. Max 20MB"); return; }
    setUploading(true); setMsg("");
    try {
      const res = await uploadDocument(file, {
        version: version || undefined,
        effectiveDate: effectiveDate || undefined,
        status: docStatus || "active",
      });
      setMsg(res.success ? `Uploaded: ${res.document.filename} (${res.document.chunkCount} chunks)` : (res.message || "Upload failed"));
      if (res.document?.status === "failed") setMsg(res.message);
      load();
    } catch (err) { setMsg(err.message); }
    setUploading(false); e.target.value = "";
  }
  async function handleDelete(id) { if (!confirm("Delete this document?")) return; await deleteDocument(id); load(); }

  return (
    <section className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-card overflow-hidden flex flex-col min-h-0 ${compact ? "rounded-lg" : "rounded-xl"}`}>
      <div className={`${compact ? "px-3 py-2.5" : "px-5 py-4"} flex items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-800 shrink-0`}>
        <div className="min-w-0">
          <h2 className={`${compact ? "text-xs" : "text-sm"} font-semibold text-gray-900 dark:text-gray-100`}>Documents</h2>
          {!compact && <p className="text-xs text-gray-500 dark:text-gray-400">Manage the PDFs used to build your knowledge base</p>}
          {compact && <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{docs.length} PDFs indexed</p>}
        </div>
        <label className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition border shrink-0 ${uploading ? "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border-gray-200 dark:border-gray-700 pointer-events-none" : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"}`}>
          {uploading ? <span className="w-3 h-3 border-2 border-gray-300 border-t-white rounded-full animate-spin" /> : <span className="text-xs leading-none">+</span>}
          {uploading ? "Uploading…" : "Upload PDF"}
          <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
        <button type="button" onClick={() => setShowMeta((v) => !v)} className="px-2 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0" title="Optional document metadata">Meta</button>
      </div>

      {showMeta && (
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800 grid grid-cols-3 gap-2 shrink-0">
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="Version (default 1.0)" className="px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
          <select value={docStatus} onChange={(e) => setDocStatus(e.target.value)} className="px-2 py-1.5 text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
            <option value="active">active</option>
            <option value="draft">draft</option>
            <option value="superseded">superseded</option>
          </select>
        </div>
      )}

      {msg && <div className={`mx-3 mt-2 text-[11px] px-2 py-1.5 rounded-lg border shrink-0 ${msg.includes("Uploaded") ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" : "bg-red-50 dark:bg-red-900/30 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300"}`}>{msg}</div>}

      <div className={`${compact ? "p-2" : "p-3"} overflow-y-auto min-h-0 ${compact ? "max-h-[220px]" : ""}`}>
        {docs.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-xl bg-gray-50/50 dark:bg-gray-800/30">
            <div className="w-10 h-10 mx-auto rounded-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-400 dark:text-gray-500">📄</div>
            <div className="mt-3 text-sm font-medium text-gray-700 dark:text-gray-200">No documents yet</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">Upload a PDF to start building your knowledge base</div>
            <label className="mt-4 inline-flex items-center px-3 py-1.5 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
              Upload PDF <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
            </label>
          </div>
        ) : (
          <ul className="space-y-1.5">
            {docs.map((d) => (
              <li key={d.id} className={`group flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition ${compact ? "px-2 py-1.5" : "px-3 py-3"}`}>
                <div className="w-7 h-7 rounded-md bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 flex items-center justify-center text-indigo-600 dark:text-indigo-300 text-[10px] font-bold shrink-0">PDF</div>
                <div className="flex-1 min-w-0">
                  <div className={`${compact ? "text-xs" : "text-sm"} font-medium text-gray-900 dark:text-gray-100 truncate pr-1`}>{d.original_filename}</div>
                  <div className="text-[10px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <Badge status={d.status} />
                    <span className="truncate">{d.status === "failed" && d.error ? d.error.slice(0, 40) : d.status === "ready" ? "Processed" : d.status}</span>
                  </div>
                </div>
                <button onClick={() => handleDelete(d.id)} className="opacity-60 group-hover:opacity-100 w-6 h-6 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/30 hover:border-red-200 dark:hover:border-red-800 hover:text-red-600 dark:hover:text-red-300 flex items-center justify-center text-gray-500 dark:text-gray-400 transition shrink-0" title="Delete">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
