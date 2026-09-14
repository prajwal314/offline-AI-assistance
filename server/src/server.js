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
});
