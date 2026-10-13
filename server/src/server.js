const express = require("express");
const cors = require("cors");
require("dotenv").config();
require("./database/db");

const documentRoutes = require("./routes/documentRoutes");
const chatRoutes = require("./routes/chatRoutes");
const knowledgeBaseRoutes = require("./routes/knowledgeBaseRoutes");
const healthRoutes = require("./routes/healthRoutes");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());



app.use("/api/documents", documentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/knowledge-base", knowledgeBaseRoutes);
app.use("/api/health", healthRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, message: "Route not found" });
});

app.use((err, req, res, next) => {
  console.error(err.message);
  if (err.message === "Only PDF files are allowed") return res.status(400).json({ success: false, message: err.message });
  if (err.code === "LIMIT_FILE_SIZE") return res.status(400).json({ success: false, message: "File too large. Max 20MB" });
  const msg = err.message || "Internal server error";
  const safe = msg.includes("stack") || msg.includes("at ") ? "Internal server error" : msg.slice(0, 500);
  if (msg.includes("Ollama") || msg.includes("Chroma") || msg.includes("embedding")) return res.status(502).json({ success: false, message: safe });
  res.status(500).json({ success: false, message: safe });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // One-time Chroma migration: legacy vectors without sessionId are assigned
  // to the same session that received the legacy SQLite rows, so nothing leaks
  // across sessions going forward. Runs in background; failures only log.
  (async () => {
    try {
      const { getDb } = require("./database/db");
      const db = getDb();
      let target = null;
      try {
        // Prefer the session holding the most legacy documents; fall back to latest.
        target = db.prepare("SELECT session_id as id, COUNT(*) as c FROM documents GROUP BY session_id ORDER BY c DESC LIMIT 1").get();
        if (!target?.id) target = db.prepare("SELECT id FROM chat_sessions ORDER BY updated_at DESC LIMIT 1").get();
      } catch {}
      if (!target?.id) return;
      const { migrateLegacyChunksToSession } = require("./services/chromaService");
      const n = await migrateLegacyChunksToSession(target.id);
      if (n > 0) console.log(`chroma migration: tagged ${n} legacy chunk(s) to session ${target.id}`);
    } catch (e) {
      console.error("chroma session migration skipped:", e.message);
    }
  })();
});
