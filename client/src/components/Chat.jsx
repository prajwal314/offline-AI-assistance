import { useEffect, useState } from "react";
import { sendChat, getHistory } from "../services/api";

export default function Chat() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  async function loadHistory() {
    try {
      const data = await getHistory();
      if (data.success) setHistory(data.history);
    } catch {}
  }

  useEffect(() => { loadHistory(); }, []);

  async function handleSend(e) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setAnswer(null);
    setSources([]);
    try {
      const data = await sendChat(question);
      if (data.success) {
        setAnswer(data.answer);
        setSources(data.sources || []);
        loadHistory();
      } else {
        setAnswer(data.message || "Error");
      }
    } catch (err) {
      setAnswer(err.message);
    }
    setLoading(false);
  }

  return (
    <div className="p-4 border rounded bg-white">
      <h2 className="font-semibold mb-2">Chat with your documents</h2>
      <form onSubmit={handleSend} className="flex gap-2 mb-3">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask a question..." className="flex-1 border rounded px-3 py-1 text-sm" />
        <button type="submit" disabled={loading} className="px-4 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50">{loading ? "..." : "Ask"}</button>
      </form>

      {answer && (
        <div className="mb-3 p-3 bg-gray-50 rounded text-sm">
          <div className="font-medium mb-1">Answer:</div>
          <div className="whitespace-pre-wrap">{answer}</div>
          {sources.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-medium">Sources ({sources.length}):</div>
              <ul className="text-xs text-gray-600 list-disc ml-4">
                {sources.map((s, i) => (
                  <li key={s.id || i}>{s.metadata?.filename || "unknown"} chunk {s.metadata?.chunkIndex} (dist {s.distance?.toFixed?.(3)}) - {s.text.slice(0, 120)}...</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="text-xs">
        <div className="font-medium mb-1">History ({history.length})</div>
        <ul className="space-y-1 max-h-64 overflow-auto">
          {history.map((h) => (
            <li key={h.id} className="border-b py-1">
              <div className="font-medium">Q: {h.question}</div>
              <div className="text-gray-600 truncate">A: {h.answer.slice(0, 120)}</div>
            </li>
          ))}
          {history.length === 0 && <li className="text-gray-400">No history</li>}
        </ul>
      </div>
    </div>
  );
}
