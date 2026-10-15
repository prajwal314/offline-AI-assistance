/**
 * Unit tests for /api/chat answer-generation fixes (no I/O: no Ollama, no DB writes).
 * - Bug 1: <think> blocks and visible chain-of-thought are stripped from the
 *   final answer (thinking is preserved separately).
 * - Bug 2: prompt context carries section/version/effective-date/status, and
 *   version conflicts across chunks of one document produce an explicit
 *   SYSTEM NOTE naming the preferred source (code-detected, not LLM-detected).
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  extractThinking,
  stripVisibleReasoning,
  cleanFinalAnswer,
  formatContext,
  buildPrompt,
  buildConflictNote,
} = require("../src/services/llmService");

function docChunk(id, text, meta = {}) {
  return {
    chunkId: id,
    id,
    text,
    metadata: { sourceType: "document", filename: "policy.pdf", documentId: "7", pageNumber: 3, ...meta },
  };
}

// ------------------------------------------------------------- Bug 1 ---

describe("think-stripping (Bug 1)", () => {
  it("strips <think> blocks but keeps thinking separately", () => {
    const { answer, thinking } = cleanFinalAnswer("<think>Let me reason step by step.</think>The fee is 500 rupees.");
    assert.equal(answer, "The fee is 500 rupees.");
    assert.match(thinking, /reason step by step/);
  });

  it("strips leading visible chain-of-thought paragraphs", () => {
    const { answer, stripped } = stripVisibleReasoning(
      "Let me think about this question.\n\nThe fee is 500 rupees."
    );
    assert.equal(answer, "The fee is 500 rupees.");
    assert.equal(stripped, 1);
  });

  it("strips multiple leading CoT paragraphs and stops at real content", () => {
    const { answer } = stripVisibleReasoning(
      "Okay, let me analyze this.\n\nFirst, I need to check the context.\n\nThe fee is 500 rupees, effective 2024-01-01."
    );
    assert.equal(answer, "The fee is 500 rupees, effective 2024-01-01.");
  });

  it("leaves normal answers untouched", () => {
    const normal = "The fee is 500 rupees.\n\nIt applies from 2024-01-01.";
    assert.equal(stripVisibleReasoning(normal).answer, normal);
    assert.equal(stripVisibleReasoning(normal).stripped, 0);
    assert.equal(cleanFinalAnswer(normal).answer, normal);
    assert.equal(cleanFinalAnswer("").answer, "");
  });
});

// ------------------------------------------------------------- Bug 2 ---

describe("versioned context + conflict note (Bug 2)", () => {
  const v1 = docChunk("7_0", "The application fee is 400 rupees for all candidates.", {
    sectionTitle: "Fees", version: "1.0", effectiveDate: "2023-01-01", status: "superseded",
  });
  const v2 = docChunk("7_1", "The application fee is 500 rupees for all candidates.", {
    sectionTitle: "Fees", version: "2.0", effectiveDate: "2024-01-01", status: "active",
  });

  it("formatContext includes section, version, effective date, status", () => {
    const ctx = formatContext([v2]);
    assert.match(ctx, /Filename: policy\.pdf/);
    assert.match(ctx, /Page: 3/);
    assert.match(ctx, /Section: Fees/);
    assert.match(ctx, /Version: 2\.0/);
    assert.match(ctx, /Effective date: 2024-01-01/);
    assert.match(ctx, /Status: ACTIVE/);
  });

  it("detects the conflict in code and names active vs superseded", () => {
    const note = buildConflictNote([v1, v2], "What is the application fee?");
    assert.ok(note, "expected a SYSTEM NOTE");
    assert.match(note, /SYSTEM NOTE/);
    assert.match(note, /2\.0/);
    assert.match(note, /SUPERSEDED/i);
    assert.match(note, /Use the active\/latest version/i);
    assert.match(note, /mention.*conflict/i);
  });

  it("prefers the version valid for a past date mentioned in the question", () => {
    const note = buildConflictNote([v1, v2], "What was the fee in 2023?");
    assert.ok(note);
    assert.match(note, /1\.0/);
    assert.match(note, /2023/);
  });

  it("returns null when there is no conflict", () => {
    assert.equal(buildConflictNote([v2], "What is the fee?"), null);
    assert.equal(buildConflictNote([], "What is the fee?"), null);
    const other = docChunk("9_0", "The library opens at 9am daily.", {
      sectionTitle: "Hours", version: "1.0", effectiveDate: "2024-01-01", status: "active",
    });
    other.metadata.documentId = "9";
    assert.equal(buildConflictNote([v2, other], "What is the fee?"), null);
  });

  it("buildPrompt embeds the SYSTEM NOTE before the question", () => {
    const prompt = buildPrompt([v1, v2], "What is the fee?", []);
    assert.ok(prompt.includes("SYSTEM NOTE"));
    const noteIdx = prompt.indexOf("SYSTEM NOTE");
    const qIdx = prompt.indexOf("QUESTION:");
    assert.ok(noteIdx !== -1 && noteIdx < qIdx);
  });
});
