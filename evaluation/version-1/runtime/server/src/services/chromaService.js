const { ChromaClient } = require("chromadb");

const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || "knowledge_base";

const client = new ChromaClient({ path: CHROMA_URL });

let collection = null;

async function getCollection() {
  if (collection) return collection;
  collection = await client.getOrCreateCollection({
    name: COLLECTION_NAME,
    metadata: { "hnsw:space": "cosine" },
  });
  return collection;
}

async function addChunks(chunks) {
  if (!chunks || chunks.length === 0) return;
  const col = await getCollection();
  const ids = chunks.map((c) => c.id);
  const embeddings = chunks.map((c) => c.embedding);
  const documents = chunks.map((c) => c.text);
  const metadatas = chunks.map((c) => c.metadata);
  await col.add({
    ids,
    embeddings,
    documents,
    metadatas,
  });
}

async function search(queryEmbedding, topK = 5, where = null) {
  const k = Math.min(20, Math.max(1, parseInt(topK, 10) || 5));
  const col = await getCollection();
  const q = {
    queryEmbeddings: [queryEmbedding],
    nResults: k,
  };
  if (where && typeof where === "object" && Object.keys(where).length > 0) q.where = where;
  const result = await col.query(q);
  const ids = result.ids[0] || [];
  const documents = result.documents[0] || [];
  const metadatas = result.metadatas[0] || [];
  const distances = result.distances ? result.distances[0] : [];

  return ids.map((id, i) => ({
    id,
    text: documents[i],
    metadata: metadatas[i],
    distance: distances[i] ?? null,
  }));
}

async function deleteByDocumentId(documentId) {
  const col = await getCollection();
  await col.delete({
    where: { documentId: String(documentId) },
  });
}

async function getCount() {
  const col = await getCollection();
  const count = await col.count();
  return count;
}

async function resetCollection() {
  try {
    await client.deleteCollection({ name: COLLECTION_NAME });
  } catch (e) {}
  collection = null;
  return getCollection();
}

module.exports = {
  getCollection,
  addChunks,
  search,
  deleteByDocumentId,
  getCount,
  resetCollection,
  COLLECTION_NAME,
  CHROMA_URL,
};
