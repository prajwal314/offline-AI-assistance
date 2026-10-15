const { ChromaClient } = require("chromadb");
const c = new ChromaClient({ path: "http://localhost:8010" });
(async () => {
  const col = await c.getOrCreateCollection({ name: "nulltest" });
  try {
    await col.add({ ids: ["1"], embeddings: [[0.1,0.2]], documents: ["hi"], metadatas: [{ a: null, b: "x" }] });
    console.log("null accepted");
    const r = await col.get({ ids: ["1"] });
    console.log(JSON.stringify(r.metadatas));
  } catch (e) {
    console.log("null error:", e.message);
  }
  try {
    await col.add({ ids: ["2"], embeddings: [[0.1,0.2]], documents: ["hi2"], metadatas: [{ c: undefined }] });
    console.log("undef accepted");
  } catch (e) {
    console.log("undef error:", e.message);
  }
})();
