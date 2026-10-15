// V2 INTEGRATION tests — run against REAL Ollama/Chroma only when explicitly
// enabled:  RUN_RAG_INTEGRATION=1 node --test tests/integration.test.js
// Otherwise every test is skipped with an explanatory message. These are the
// "real end-to-end" tests; tests/evidenceService.test.js and
// tests/confidenceRag.test.js are the deterministic mocked unit tests.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const ENABLED = process.env.RUN_RAG_INTEGRATION === "1";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";

async function probe(url, ms = 4000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    const res = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

describe("V2 integration (real services)", async () => {
  const ollamaUp = ENABLED && (await probe(`${OLLAMA_URL}/api/tags`));
  const chromaUp = ENABLED && (await probe(`${CHROMA_URL}/api/v2/heartbeat`));

  it("environment gate", (t) => {
    if (!ENABLED) return t.skip("set RUN_RAG_INTEGRATION=1 to run real-service tests");
    if (!ollamaUp) return t.skip("Ollama not reachable at " + OLLAMA_URL);
  });

  it("evidence checker returns a VALIDATED structured verdict on real LLM", async (t) => {
    if (!ENABLED || !ollamaUp) return t.skip("real Ollama required");
    const { checkEvidenceSufficiency } = require("../src/services/evidenceService");
    const chunks = [
      { id: "doc_0", text: "The capital of France is Paris. It has hosted major climate summits.", distance: 0.35, metadata: {} },
    ];
    const v = await checkEvidenceSufficiency("What is the capital of France?", chunks);
    assert.equal(typeof v.sufficient, "boolean");
    assert.equal(typeof v.reason, "string");
    assert.ok(Array.isArray(v.relevant_chunk_ids));
    assert.equal(v.method, "llm");
  });

  it("query refinement returns a non-empty query on real LLM", async (t) => {
    if (!ENABLED || !ollamaUp) return t.skip("real Ollama required");
    const { refineQuery } = require("../src/services/evidenceService");
    const q = await refineQuery("What does the paper say about its method?");
    assert.ok(q.length > 3, "expected a rewritten query, got: " + q);
  });

  it("full V2 flow answers against the real knowledge base when Chroma is up", async (t) => {
    if (!ENABLED || !ollamaUp || !chromaUp) return t.skip("Ollama + Chroma required");
    const { runConfidenceAwareRetrieval } = require("../src/services/confidenceRagService");
    const trace = await runConfidenceAwareRetrieval("What is the main topic of the uploaded documents?", { topK: 5 });
    assert.ok(["answer", "abstain"].includes(trace.decision));
    assert.ok(trace.retryCount <= 1);
    assert.ok(trace.latencyMs >= 0);
  });
});
