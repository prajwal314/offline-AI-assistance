import { useEffect, useState } from "react";
import { listDocuments, deleteDocument, uploadDocument } from "../services/api";

function Badge({ status }) {
  const m = {
    ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
    processing: "bg-amber-50 text-amber-700 border-amber-200",
    failed: "bg-red-50 text-red-700 border-red-200",
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${m[status] || "bg-gray-50 text-gray-600 border-gray-200"}`}>{status}</span>;
}

export default function DocumentList({ onUpdate }) {
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  async function load() { const data = await listDocuments(); if (data.success) setDocs(data.documents); if (onUpdate) onUpdate(); }
  useEffect(() => { load(); }, []);
  async function handleUpload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) { setMsg("Only PDF files are allowed"); return; }
    if (file.size > 20 * 1024 * 1024) { setMsg("File too large. Max 20MB"); return; }
    setUploading(true); setMsg("");
    try {
      const res = await uploadDocument(file);
      setMsg(res.success ? `Uploaded: ${res.document.filename} (${res.document.chunkCount} chunks)` : (res.message || "Upload failed"));
      if (res.document?.status === "failed") setMsg(res.message);
      load();
    } catch (err) { setMsg(err.message); }
    setUploading(false); e.target.value = "";
  }
  async function handleDelete(id) { if (!confirm("Delete this document?")) return; await deleteDocument(id); load(); }

  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-card overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Documents</h2>
          <p className="text-xs text-gray-500">Manage the PDFs used to build your knowledge base</p>
        </div>
        <label className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold cursor-pointer transition border ${uploading ? "bg-gray-100 text-gray-400 border-gray-200 pointer-events-none" : "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"}`}>
          {uploading ? <span className="w-3 h-3 border-2 border-gray-300 border-t-white rounded-full animate-spin" /> : <span className="text-sm leading-none">+</span>}
          {uploading ? "Uploading…" : "Upload PDF"}
          <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {msg && <div className={`mx-5 mt-3 text-xs px-3 py-2 rounded-lg border ${msg.includes("Uploaded") ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>{msg}</div>}

      <div className="p-3">
        {docs.length === 0 ? (
          <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50/50">
            <div className="w-10 h-10 mx-auto rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400">📄</div>
            <div className="mt-3 text-sm font-medium text-gray-700">No documents yet</div>
            <div className="text-xs text-gray-500 mt-1">Upload a PDF to start building your knowledge base</div>
            <label className="mt-4 inline-flex items-center px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs font-medium cursor-pointer hover:bg-gray-50">
              Upload PDF <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} />
            </label>
          </div>
        ) : (
          <ul className="space-y-2">
            {docs.map((d) => (
              <li key={d.id} className="group flex items-center gap-3 px-3 py-3 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 text-xs shrink-0">PDF</div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate pr-2">{d.original_filename}</div>
                  <div className="text-[11px] text-gray-500 flex items-center gap-2">
                    <span>PDF</span>
                    <span className="w-1 h-1 rounded-full bg-gray-300" />
                    <span className="truncate">{d.status === "failed" && d.error ? d.error.slice(0, 60) : d.status === "ready" ? "Processed" : d.status}</span>
                  </div>
                </div>
                <Badge status={d.status} />
                <button onClick={() => handleDelete(d.id)} className="opacity-60 group-hover:opacity-100 ml-1 w-7 h-7 rounded-lg border border-gray-200 bg-white hover:bg-red-50 hover:border-red-200 hover:text-red-600 flex items-center justify-center text-gray-500 transition" title="Delete">×</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
