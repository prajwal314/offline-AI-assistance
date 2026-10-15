/**
 * Unit tests for Change 4 (evidence assembly): decomposition, coverage,
 * greedy selection, conflicts, sufficiency/retries, and the assembler.
 * All I/O is stubbed — no Ollama/Chroma needed. Run with: npm test
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { decomposeQuestion, extractJsonArray, cleanRequirements } = require("../src/evidence/decompose");
const { assessCoverage, lexicalCoverScore } = require("../src/evidence/coverage");
const { selectEvidence } = require("../src/evidence/select");
const { detectConflicts, pickPreferred } = require("../src/evidence/conflicts");
const { decideVerdict } = require("../src/evidence/sufficiency");
const { assembleEvidence } = require("../src/evidence/assembler");

function chunk(id, text, meta = {}, extra = {}) {
  return { chunkId: id, id, text, metadata: { ...meta }, evidenceScore: 0.8, ...extra };
}

// ------------------------------------------------------------ decompose ---

describe("question decomposition", () => {
  it("parses a strict JSON array from the LLM", async () => {
    const fetchFn = async () => ({ ok: true, json: async () => ({ response: '["What is the fee?", "What is the deadline?"]' }) });
    const res = await decomposeQuestion("What is the fee, and also what is the deadline for applying this year?", { fetchFn });
    assert.equal(res.method, "llm");
    assert.deepEqual(res.requirements.map((r) => r.text), ["What is the fee?", "What is the deadline?"]);
  });

  it("falls back to the whole question when the LLM fails", async () => {
    const q = "What is the fee, and also what is the deadline for applying this year?";
    const res = await decomposeQuestion(q, { fetchFn: async () => { throw new Error("Ollama down"); } });
    assert.equal(res.method, "fallback");
    assert.deepEqual(res.requirements.map((r) => r.text), [q]);
  });

  it("falls back on unparsable output", async () => {
    const fetchFn = async () => ({ ok: true, json: async () => ({ response: "The fee is 500." }) });
    const res = await decomposeQuestion("Explain the fee structure and the refund policy in detail please?", { fetchFn });
    assert.equal(res.method, "fallback");
    assert.equal(res.requirements.length, 1);
  });

  it("extractJsonArray tolerates fences and prose", () => {
    assert.deepEqual(extractJsonArray('```json\n["a", "b"]\n```'), ["a", "b"]);
    assert.deepEqual(extractJsonArray('Here you go: ["a"] thanks'), ["a"]);
    assert.equal(extractJsonArray("no json here"), null);
    assert.deepEqual(cleanRequirements(["a", "  ", "A", "ok fine yes"]), ["ok fine yes"]);
  });
});

// ------------------------------------------------------------- coverage ---

describe("coverage assessment", () => {
  it("lexical recall marks covering chunks", () => {
    assert.ok(lexicalCoverScore("What is the application fee?", "The application fee is 500 rupees") >= 0.35);
    assert.ok(lexicalCoverScore("What is the application fee?", "Weather is sunny today") < 0.35);
  });

  it("reports per-requirement coverage and ratio", async () => {
    const reqs = [{ id: "r1", text: "application fee" }, { id: "r2", text: "deadline" }];
    const cov = await assessCoverage(reqs, [
      chunk("c1", "The application fee is 500 rupees"),
      chunk("c2", "The deadline is 30 September"),
    ]);
    assert.equal(cov.coverageRatio, 1);
    assert.deepEqual(cov.uncovered, []);
    assert.ok(cov.chunkCovers.c1.some((e) => e.requirementId === "r1"));
  });
});

// ------------------------------------------------------------ selection ---

describe("greedy selection with soft redundancy", () => {
  const reqs = [{ id: "r1", text: "alpha beta gamma" }, { id: "r2", text: "delta epsilon zeta" }];

  it("never drops the only chunk covering a sub-requirement", async () => {
    const cands = [
      chunk("c1", "alpha beta gamma common filler words here", {}, { evidenceScore: 0.5 }),
      chunk("c2", "delta epsilon zeta common filler words here", {}, { evidenceScore: 0.9 }),
    ];
    const cov = await assessCoverage(reqs, cands);
    const { selected } = selectEvidence(reqs, cands, cov, { topK: 5 });
    const ids = selected.map((c) => c.chunkId);
    assert.ok(ids.includes("c1"), "sole coverer of r1 must survive despite similarity to c2");
    assert.ok(ids.includes("c2"));
  });

  it("redundancy is a soft penalty: diverse chunk beats redundant one", async () => {
    const reqs1 = [{ id: "r1", text: "server port configuration" }];
    const cands = [
      chunk("c1", "server port configuration steps", {}, { evidenceScore: 0.9 }),
      chunk("c2", "server port configuration steps", {}, { evidenceScore: 0.85 }),
      chunk("c3", "server port plus timeout tuning extras", {}, { evidenceScore: 0.7 }),
    ];
    const cov = await assessCoverage(reqs1, cands);
    const { selected, decisions } = selectEvidence(reqs1, cands, cov, { topK: 2 });
    const ids = selected.map((c) => c.chunkId);
    assert.deepEqual(ids, ["c1", "c3"]);
    assert.ok(decisions.some((d) => d.chunkId === "c2" && d.action === "skipped"));
  });
});

// ------------------------------------------------------------ conflicts ---

describe("conflict detection across versions", () => {
  const c1 = chunk("c1", "The application fee is 500 rupees under the CAT 2026 policy", { documentId: "1", version: "2.0", status: "active", effectiveDate: "2024-01-01" });
  const c2 = chunk("c2", "The application fee is 400 rupees under the CAT 2026 policy", { documentId: "1", version: "1.0", status: "superseded", effectiveDate: "2023-01-01" });

  it("flags same-document differing-version claims and prefers active/latest", () => {
    const conflicts = detectConflicts([c1, c2]);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].preferredChunkId, "c1");
    assert.ok(conflicts[0].summary.includes("2.0") && conflicts[0].summary.includes("1.0"));
  });

  it("pickPreferred orders active > draft > superseded", () => {
    const order = [
      chunk("s", "t", { status: "superseded" }),
      chunk("d", "t", { status: "draft" }),
      chunk("a", "t", { status: "active" }),
    ];
    assert.equal(pickPreferred(order).chunkId, "a");
  });

  it("no conflict for identical versions or unrelated chunks", () => {
    assert.deepEqual(detectConflicts([c1, { ...c1, chunkId: "c1b", id: "c1b" }]), []);
    assert.deepEqual(detectConflicts([c1, chunk("x", "completely different weather topic", { documentId: "9", version: "9.9" })]), []);
  });
});

// ---------------------------------------------------------- sufficiency ---

describe("sufficiency verdicts", () => {
  it("answer / qualified / retry / abstain", () => {
    assert.equal(decideVerdict({ coverageRatio: 1, uncovered: [], conflicts: [], retriesExhausted: true }), "answer");
    assert.equal(decideVerdict({ coverageRatio: 1, uncovered: [], conflicts: [{ summary: "x" }], retriesExhausted: true }), "qualified");
    assert.equal(decideVerdict({ coverageRatio: 0.5, uncovered: ["r2"], conflicts: [], retriesExhausted: false }), "retry");
    assert.equal(decideVerdict({ coverageRatio: 0.5, uncovered: ["r2"], conflicts: [], retriesExhausted: true }), "abstain");
  });
});

// ------------------------------------------------------------ assembler ---

describe("assembler end-to-end (stubbed retrieval)", () => {
  it("multi-chunk question: full coverage, all parts selected, verdict answer", async () => {
    const fetchFn = async () => ({ ok: true, json: async () => ({ response: '["What is the application fee?", "What is the application deadline?"]' }) });
    const retrieveFn = async () => [
      chunk("c1", "The application fee is 500 rupees for all candidates", {}, { evidenceScore: 0.9 }),
      chunk("c2", "The application deadline is 30 September 2024", {}, { evidenceScore: 0.85 }),
      chunk("c3", "Weather forecast for the weekend", {}, { evidenceScore: 0.1 }),
    ];
    const res = await assembleEvidence("What is the fee, and also what is the deadline for applying?", retrieveFn, {
      topK: 5,
      decomposeFetchFn: fetchFn,
    });
    assert.equal(res.verdict, "answer");
    assert.equal(res.coverage.coverageRatio, 1);
    const ids = res.selected.map((c) => c.chunkId);
    assert.ok(ids.includes("c1") && ids.includes("c2"), `selected=${ids}`);
    assert.ok(res.debug.requirements.length === 2);
    assert.ok(Array.isArray(res.debug.decisions) && res.debug.decisions.length > 0);
  });

  it("conflicting-version case: conflict surfaced, active preferred, verdict qualified", async () => {
    const retrieveFn = async () => [
      chunk("c1", "The application fee is 500 rupees under the CAT 2026 policy", { documentId: "1", version: "2.0", status: "active", effectiveDate: "2024-01-01" }, { evidenceScore: 0.9 }),
      chunk("c2", "The application fee is 400 rupees under the CAT 2026 policy", { documentId: "1", version: "1.0", status: "superseded", effectiveDate: "2023-01-01" }, { evidenceScore: 0.7 }),
    ];
    const res = await assembleEvidence("What is the fee?", retrieveFn, { topK: 5 });
    assert.equal(res.verdict, "qualified");
    assert.equal(res.conflicts.length, 1);
    assert.equal(res.conflicts[0].preferredChunkId, "c1");
    assert.ok(res.message.includes("2.0"));
  });

  it("insufficient-evidence case: bounded retries then abstain with clear message", async () => {
    let calls = 0;
    const retrieveFn = async () => { calls++; return []; };
    const res = await assembleEvidence("What is the fee?", retrieveFn, { topK: 5 });
    assert.equal(res.verdict, "abstain");
    assert.equal(calls, 3, "initial + max 2 retries");
    assert.equal(res.debug.retriesUsed, 2);
    assert.ok(res.message.toLowerCase().includes("could not find"));
    assert.deepEqual(res.selected, []);
  });

  it("retry can rescue partial coverage", async () => {
    let calls = 0;
    const retrieveFn = async (q, tk, attempt) => {
      calls++;
      if (attempt === 0) return [chunk("c1", "The application fee is 500 rupees", {}, { evidenceScore: 0.9 })];
      return [chunk("c1", "The application fee is 500 rupees", {}, { evidenceScore: 0.9 }), chunk("c2", "The library closes at midnight", {}, { evidenceScore: 0.85 })];
    };
    const fetchFn = async () => ({ ok: true, json: async () => ({ response: '["What is the application fee?", "When does the library close?"]' }) });
    const res = await assembleEvidence("What is the fee, and also when does the library close this week?", retrieveFn, {
      topK: 5,
      decomposeFetchFn: fetchFn,
    });
    assert.equal(calls, 2);
    assert.equal(res.verdict, "answer");
    assert.equal(res.debug.retriesUsed, 1);
  });
});
