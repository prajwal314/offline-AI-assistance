// V2 unit tests — evidence sufficiency checker (uses node --test, no new deps).
// All LLM calls are mocked for determinism (mocked tests). Real end-to-end
// coverage lives in tests/integration.test.js (gated) + evaluation/runEvaluationV2.js.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCheckerOutput,
  rulePreCheck,
  checkEvidenceSufficiency,
  refineQuery,
  keywordOverlap,
} = require("../src/services/evidenceService");

const CHUNKS = [
  { id: "1_0", text: "The transformer architecture was introduced in 2017 for machine translation.", distance: 0.4, metadata: {} },
  { id: "1_1", text: "Attention mechanisms allow the model to weigh input tokens differently.", distance: 0.6, metadata: {} },
];

describe("evidenceService — rule pre-check", () => {
  it("empty retrieval is insufficient without calling the LLM", async () => {
    let called = false;
    const verdict = await checkEvidenceSufficiency("What is X?", [], { llmCall: async () => { called = true; return "{}"; } });
    assert.equal(called, false);
    assert.equal(verdict.sufficient, false);
    assert.equal(verdict.method, "rule");
  });

  it("blank/whitespace passages are insufficient via rules", () => {
    const v = rulePreCheck("What is X?", [{ id: "a", text: "   " }]);
    assert.ok(v);
    assert.equal(v.sufficient, false);
  });
});

describe("evidenceService — structured output validation (Test F)", () => {
  it("accepts a well-formed verdict and filters unknown chunk ids", () => {
    const raw = 'prefix {"sufficient": true, "reason": "states the date", "missing_information": "", "relevant_chunk_ids": ["1_0", "ghost"], "conflict": false} suffix';
    const v = parseCheckerOutput(raw, CHUNKS);
    assert.ok(v);
    assert.equal(v.sufficient, true);
    assert.deepEqual(v.relevant_chunk_ids, ["1_0"]);
    assert.equal(v.conflict, false);
  });

  it("rejects malformed output (no JSON / wrong types)", () => {
    assert.equal(parseCheckerOutput("looks sufficient to me", CHUNKS), null);
    assert.equal(parseCheckerOutput('{"sufficient": "yes"}', CHUNKS), null);
    assert.equal(parseCheckerOutput("", CHUNKS), null);
  });

  it("malformed checker output fails SAFE toward abstention, never sufficient", async () => {
    const verdict = await checkEvidenceSufficiency("When was X introduced?", CHUNKS, {
      llmCall: async () => "The passages look sufficient, trust me.",
    });
    assert.equal(verdict.sufficient, false);
    assert.equal(verdict.method, "llm-malformed");
  });

  it("checker LLM failure falls back with the error recorded (not disguised)", async () => {
    const verdict = await checkEvidenceSufficiency("When was X introduced?", CHUNKS, {
      llmCall: async () => { throw new Error("Ollama generate failed: 500 boom"); },
    });
    assert.ok(verdict.checkerError.includes("Ollama"));
    assert.equal(verdict.method, "rule-fallback");
  });
});

describe("evidenceService — query refinement", () => {
  it("returns the cleaned rewritten query", async () => {
    const q = await refineQuery("What is this doc about?", { llmCall: async () => '"main topic research document"\n' });
    assert.equal(q, "main topic research document");
  });

  it("empty refinement output throws (caller abstains, never fabricates)", async () => {
    await assert.rejects(() => refineQuery("What?", { llmCall: async () => "   " }), /empty query/);
  });
});

describe("evidenceService — keyword overlap signal", () => {
  it("measures question keyword presence in chunks", () => {
    const { overlap } = keywordOverlap("When was the transformer architecture introduced?", CHUNKS);
    assert.ok(overlap > 0.3, `expected overlap, got ${overlap}`);
    const none = keywordOverlap("What was the population of Mars?", CHUNKS);
    assert.equal(none.overlap, 0);
  });
});
