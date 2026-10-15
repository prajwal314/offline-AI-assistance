// V2 unit tests — one-retry orchestrator decision flow (Tests A–E, G, H).
// search/check/refine are injected mocks: deterministic, no services needed.
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runConfidenceAwareRetrieval } = require("../src/services/confidenceRagService");

const Q = "When was the transformer architecture introduced?";
const GOOD = [{ id: "1_0", text: "The transformer was introduced in 2017.", distance: 0.3, metadata: {} }];
const BAD = [{ id: "2_0", text: "Penguins eat fish in Antarctica.", distance: 1.4, metadata: {} }];

function searchReturning(batches) {
  const calls = [];
  const fn = async (query, topK, opts) => {
    calls.push({ query, topK, opts });
    const batch = batches[Math.min(calls.length - 1, batches.length - 1)];
    return { results: batch, topK, threshold: opts.threshold ?? null, filteredCount: 0, where: null };
  };
  fn.calls = calls;
  return fn;
}

const sufficient = (conflict = false) => async () => ({
  sufficient: true, reason: "states it", missing_information: "", relevant_chunk_ids: [], conflict, method: "llm",
});
const insufficient = (conflict = false) => async () => ({
  sufficient: false, reason: "not stated", missing_information: "the date", relevant_chunk_ids: [], conflict, method: "llm",
});

describe("confidenceRagService decision flow", () => {
  it("Test A — sufficient initial evidence answers WITHOUT retry", async () => {
    const search = searchReturning([GOOD]);
    let refines = 0;
    const trace = await runConfidenceAwareRetrieval(Q, {
      topK: 5, searchFn: search, checkFn: sufficient(), refineFn: async () => { refines++; return "x"; },
    });
    assert.equal(trace.decision, "answer");
    assert.equal(trace.retryOccurred, false);
    assert.equal(refines, 0);
    assert.equal(search.calls.length, 1);
    assert.deepEqual(trace.chunks, GOOD);
  });

  it("Test B — insufficient first, retry recovers → answer with recovery recorded", async () => {
    const search = searchReturning([BAD, GOOD]);
    let n = 0;
    const trace = await runConfidenceAwareRetrieval(Q, {
      topK: 5,
      searchFn: search,
      checkFn: async () => { n++; return n === 1 ? insufficient()() : sufficient()(); },
      refineFn: async () => "transformer architecture introduction year",
    });
    assert.equal(trace.decision, "answer");
    assert.equal(trace.retryOccurred, true);
    assert.equal(trace.retryCount, 1);
    assert.equal(trace.recovered, true);
    assert.equal(trace.refinedQuery, "transformer architecture introduction year");
    assert.equal(search.calls.length, 2);
    // Same Top-K and filter on both attempts — never silently altered.
    assert.equal(search.calls[0].topK, 5);
    assert.equal(search.calls[1].topK, 5);
    assert.deepEqual(search.calls[0].opts, search.calls[1].opts);
    // Second attempt embeds the REFINED query, original intent preserved upstream.
    assert.equal(search.calls[1].query, "transformer architecture introduction year");
  });

  it("Test C — both attempts insufficient → abstain", async () => {
    const search = searchReturning([BAD, BAD]);
    const trace = await runConfidenceAwareRetrieval(Q, {
      searchFn: search, checkFn: insufficient(), refineFn: async () => "refined q",
    });
    assert.equal(trace.decision, "abstain");
    assert.equal(trace.retryOccurred, true);
    assert.equal(trace.recovered, false);
  });

  it("Test D — zero initial results → at most one retry, then abstain", async () => {
    const search = searchReturning([[], []]);
    const trace = await runConfidenceAwareRetrieval(Q, {
      searchFn: search, checkFn: insufficient(), refineFn: async () => "refined q",
    });
    assert.equal(trace.decision, "abstain");
    assert.ok(search.calls.length <= 2, `expected ≤2 retrievals, got ${search.calls.length}`);
  });

  it("Test E — contradictory evidence is flagged, never answered confidently", async () => {
    const search = searchReturning([GOOD]);
    const trace = await runConfidenceAwareRetrieval(Q, {
      searchFn: search, checkFn: insufficient(true), refineFn: async () => "refined q",
    });
    // With conflict + insufficiency the orchestrator abstains; the conflict
    // flag survives in metadata so the UI/researcher can see it.
    assert.equal(trace.decision, "abstain");
    assert.equal(trace.finalEvidence.conflict, true);
  });

  it("refinement failure → abstain with the error recorded, no retry", async () => {
    const search = searchReturning([BAD]);
    const trace = await runConfidenceAwareRetrieval(Q, {
      searchFn: search,
      checkFn: insufficient(),
      refineFn: async () => { throw new Error("Ollama generate failed: 500 down"); },
    });
    assert.equal(trace.decision, "abstain");
    assert.equal(trace.retryOccurred, false);
    assert.ok(trace.refineError.includes("Ollama"));
    assert.equal(search.calls.length, 1);
  });

  it("Test G — Chroma/embedding outage is a TECHNICAL error, not an abstention", async () => {
    const search = async () => { throw new Error("ChromaDB unavailable: ECONNREFUSED"); };
    await assert.rejects(
      () => runConfidenceAwareRetrieval(Q, { searchFn: search, checkFn: sufficient(), refineFn: async () => "q" }),
      /ChromaDB unavailable/
    );
  });

  it("Test H — a single question never triggers more than one retry", async () => {
    for (const batches of [[BAD, BAD], [[], []], [BAD, GOOD]]) {
      const search = searchReturning(batches);
      let n = 0;
      await runConfidenceAwareRetrieval(Q, {
        searchFn: search,
        checkFn: async () => { n++; return insufficient()(); },
        refineFn: async () => "refined q",
      });
      assert.ok(search.calls.length <= 2, `retry limit violated: ${search.calls.length} retrievals`);
    }
    // Structural guarantee: the constant itself.
    const { MAX_RETRIES } = require("../src/services/evidenceService");
    assert.equal(MAX_RETRIES, 1);
  });
});
