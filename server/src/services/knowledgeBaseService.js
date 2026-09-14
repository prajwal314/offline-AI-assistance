const { getDb } = require("../database/db");
const { extractTopics } = require("./topicService");
const { generateQueries } = require("./searchQueryService");
const { webSearch } = require("./webSearchService");
const { webFetch } = require("./webFetchService");
const { cleanText } = require("./textCleaningService");
const { chunkText } = require("./chunkingService");
const { generateEmbeddings } = require("./embeddingService");
const { addChunks } = require("./chromaService");

function setStatus(fields) {
  const db = getDb();
  const cur = db.prepare("SELECT * FROM kb_build_status WHERE id=1").get();
  const next = { ...cur, ...fields, updated_at: new Date().toISOString() };
  db.prepare("UPDATE kb_build_status SET status=?,current_step=?,total_sources=?,processed_sources=?,failed_sources=?,chunks_created=?,updated_at=? WHERE id=1")
    .run(next.status, next.current_step, next.total_sources, next.processed_sources, next.failed_sources, next.chunks_created, next.updated_at);
}

async function buildKnowledgeBase() {
  const db = getDb();
  const curStatus = db.prepare("SELECT status FROM kb_build_status WHERE id=1").get();
  if (curStatus.status === "processing") throw new Error("Build already in progress");
  setStatus({ status: "processing", current_step: "Starting", total_sources: 0, processed_sources: 0, failed_sources: 0, chunks_created: 0 });

  (async () => {
    try {
      const docs = db.prepare("SELECT * FROM documents WHERE status='ready'").all();
      if (docs.length === 0) throw new Error("No ready documents — upload PDFs first");

      setStatus({ current_step: "Extracting topics" });
      const { topics } = await extractTopics(docs);

      setStatus({ current_step: "Generating queries" });
      const { queries } = await generateQueries(topics);

      setStatus({ current_step: "Searching web" });
      let allResults = [];
      for (const q of queries.slice(0, 8)) {
        try {
          const r = await webSearch(q, 5);
          allResults.push(...r.map((x) => ({ ...x, topic: topics[0] })));
        } catch {}
      }
      const seen = new Set();
      const unique = [];
      for (const r of allResults) {
        const url = r.url.trim();
        if (seen.has(url)) continue;
        seen.add(url);
        const exists = db.prepare("SELECT id FROM research_sources WHERE url=?").get(url);
        if (exists) continue;
        unique.push(r);
      }
      const limited = unique.slice(0, 12);
      if (limited.length === 0) {
        setStatus({ status: "completed", current_step: "No new sources found" });
        return;
      }
      for (const r of limited) {
        db.prepare("INSERT OR IGNORE INTO research_sources (url,title,topic,status,added_at) VALUES (?,?,?,?,?)")
          .run(r.url, r.title, r.topic, "pending", new Date().toISOString());
      }
      setStatus({ total_sources: limited.length, current_step: "Fetching pages" });

      let processed = 0, failed = 0, chunksCreated = 0;
      const pending = db.prepare("SELECT * FROM research_sources WHERE status='pending'").all();
      for (const src of pending) {
        try {
          db.prepare("UPDATE research_sources SET status='processing' WHERE id=?").run(src.id);
          setStatus({ current_step: `Fetching: ${src.title.slice(0,40)}` });
          const fetched = await webFetch(src.url);
          const cleaned = cleanText(fetched.content);
          if (!cleaned || cleaned.length < 200) throw new Error("Empty content after cleaning");
          setStatus({ current_step: `Chunking: ${src.title.slice(0,30)}` });
          const chunks = chunkText(cleaned);
          if (chunks.length === 0) throw new Error("No chunks");
          setStatus({ current_step: `Embedding: ${src.title.slice(0,30)}` });
          const embeddings = await generateEmbeddings(chunks);
          const chromaChunks = chunks.map((text, i) => ({
            id: `web_${src.id}_${i}`,
            text,
            embedding: embeddings[i],
            metadata: { sourceType: "web", url: src.url, title: fetched.title || src.title, topic: src.topic, sourceId: String(src.id), chunkIndex: i },
          }));
          await addChunks(chromaChunks);
          db.prepare("UPDATE research_sources SET status='completed', chunk_count=?, title=? WHERE id=?").run(chunks.length, fetched.title || src.title, src.id);
          processed++; chunksCreated += chunks.length;
          setStatus({ processed_sources: processed, failed_sources: failed, chunks_created: chunksCreated });
        } catch (e) {
          db.prepare("UPDATE research_sources SET status='failed', error=? WHERE id=?").run(String(e.message).slice(0,500), src.id);
          failed++;
          setStatus({ processed_sources: processed, failed_sources: failed });
        }
      }
      setStatus({ status: "completed", current_step: "Completed" });
    } catch (e) {
      setStatus({ status: "failed", current_step: String(e.message).slice(0,200) });
    }
  })();
}

function getStatus() {
  const db = getDb();
  const s = db.prepare("SELECT * FROM kb_build_status WHERE id=1").get();
  const counts = db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM research_sources").get();
  const webSources = counts.completed || 0;
  const docCount = db.prepare("SELECT COUNT(*) as c FROM documents WHERE status='ready'").get().c;
  return { ...s, webSources, documents: docCount };
}

module.exports = { buildKnowledgeBase, getStatus, setStatus };
