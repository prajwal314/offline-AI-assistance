import { useEffect, useState } from "react";
import { listDocuments, deleteDocument, uploadDocument } from "../services/api";
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
  async function handleDelete(id) { await deleteDocument(id); load(); }
  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="font-semibold mb-2">Documents</h2>
      <label className="inline-block mb-2 px-3 py-1 bg-blue-600 text-white rounded text-sm cursor-pointer">
        {uploading ? "Uploading..." : "Upload PDF"}
        <input type="file" accept=".pdf" className="hidden" onChange={handleUpload} disabled={uploading} />
      </label>
      {msg && <div className={`text-xs mb-2 ${msg.includes("Uploaded") ? "text-green-600" : "text-red-600"}`}>{msg}</div>}
      <ul className="space-y-1">
        {docs.map((d) => (
          <li key={d.id} className="flex justify-between items-center text-sm border-b py-1">
            <span className="truncate pr-2">{d.original_filename}
              <span className={`ml-2 text-xs px-1 rounded ${d.status === "ready" ? "bg-green-100" : d.status === "failed" ? "bg-red-100" : d.status === "processing" ? "bg-yellow-100" : "bg-gray-100"}`}>{d.status}</span>
              {d.status === "failed" && d.error && <span className="ml-1 text-[11px] text-red-600">— {d.error.slice(0, 80)}</span>}
            </span>
            <button onClick={() => handleDelete(d.id)} className="text-red-600 text-xs shrink-0">Delete</button>
          </li>
        ))}
        {docs.length === 0 && <li className="text-xs text-gray-400">No documents — upload a PDF to start.</li>}
      </ul>
    </div>
  );
}
