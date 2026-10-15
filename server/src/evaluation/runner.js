/**
 * Experiment runner (Change 5, step 4).
 * Evaluates experiments A–E on the same questions and corpus:
 *   A dense only | B hybrid | C hybrid+rerank | D hybrid+rerank+metadata
 *   E adaptive scoring + evidence-set selection
 * Method E runs the Change-4 assembler (bounded retries included); A–D use
 * retrieve() directly. Conflict detection runs uniformly on every method's
 * selection. Results persist to evaluation_runs / evaluation_results.
 * No superiority claims here — the comparison table is descriptive only.
 */

const { getDb } = require("../database/db");
const { retrieve } = require("../retrieval/index");
const { assembleEvidence } = require("../evidence/assembler");
const { detectConflicts } = require("../evidence/conflicts");
const {
  precisionAtK, recallAtK, reciprocalRank, ndcgAtK, evidenceCoverage,
  redundancyRate, conflictCorrectness, conflictHandled, contextTokens,
  judgeFaithfulness, judgeCitations, judgeCorrectness, tokenF1,
  judgeGroundedness, measureConsistency,
} = require("./evalMetrics");

const METHOD_MODES = {
  A: "dense",
  B: "hybrid",
  C: "hybrid_rerank",
  D: "hybrid_rerank_meta",
  E: "adaptive",
};

function parseMethods(input) {
  const list = Array.isArray(input) ? input : String(input || "A,B,C,D,E").split(/[,\s]+/);
  const out = [...new Set(list.map((s) => String(s).trim().toUpperCase()).filter((s) => METHOD_MODES[s]))];
  if (out.length === 0) throw new Error(`no valid methods (expected letters A-E, got "${input}")`);
  return out;
}

function chunkIdOf(c, i) {
  return String(c?.chunkId ?? c?.id ?? `c${i}`);
}

function requiredIdsOf(question) {
  try {
    const v = typeof question.required_evidence_ids === "string"
      ? JSON.parse(question.required_evidence_ids)
      : question.required_evidence_ids;
    return (Array.isArray(v) ? v : []).map(String);
  } catch { return []; }
}

async function evaluateQuestion(question, methodLetter, opts = {}) {
  const t0 = Date.now();
  const topK = Math.max(1, parseInt(opts.topK, 10) || 5);
  const mode = METHOD_MODES[methodLetter];
  const retrieveFn = opts.retrieve || ((q, rOpts) => retrieve(q, rOpts));
  const required = requiredIdsOf(question);

  // One retrieval+selection pass. Timed separately so per-question latency
  // can be broken down by stage (retrieval vs selection vs generation).
  // NOTE on stage boundaries: for method E the assembler call below includes
  // its internal selection work inside retrieval_ms; selection_ms then covers
  // only the final shaping. Reported as measured, not reallocated.
  async function singlePass() {
    const tR0 = Date.now();
    let selected;
    let conflicts;
    let debug = null;
    let verdict = null;
    if (methodLetter === "E") {
      const assembled = await assembleEvidence(
        question.query,
        (qq, tk) => retrieveFn(qq, { mode: "adaptive", topK: tk }),
        { topK, coverageMethod: opts.coverageMethod, maxRetries: opts.maxRetries, decomposeFetchFn: opts.decomposeFetchFn }
      );
      selected = assembled.selected;
      conflicts = assembled.conflicts;
      debug = assembled.debug;
      verdict = assembled.verdict;
    } else {
      selected = (await retrieveFn(question.query, { mode, topK })) || [];
    }
    const retrieval_ms = Date.now() - tR0;
    const tS0 = Date.now();
    if (methodLetter !== "E") {
      conflicts = detectConflicts(selected);
    }
    const selection_ms = Date.now() - tS0;
    return { selected: selected || [], conflicts: conflicts || [], debug, verdict, retrieval_ms, selection_ms };
  }

  // Answer generation (optional, off by default). Answer-dependent metrics
  // (correctness, groundedness) are computed by default whenever an answer
  // exists — no opt-out flag.
  async function generateFor(selected) {
    const tG0 = Date.now();
    try {
      const gen = opts.generateFn || require("../services/llmService").generateAnswer;
      const genRes = await gen(question.query, selected);
      const answer = typeof genRes === "string" ? genRes : genRes?.answer || "";
      return { answer, generation_ms: Date.now() - tG0 };
    } catch (err) {
      return { answer: `ERROR: ${String(err.message || err).slice(0, 200)}`, generation_ms: Date.now() - tG0 };
    }
  }

  try {
    const consistencyN = Math.max(0, parseInt(opts.consistencyN, 10) || 0);
    let pass = await singlePass();
    let agreement = null;
    let stability = null;
    let consistencyRuns = null;
    if (consistencyN >= 2) {
      // Repeat the whole pass N times: agreement over answers, stability
      // over selected chunk sets. Primary (persisted) result is run 1.
      const runs = [{ answer: null, selected: pass.selected }];
      for (let i = 1; i < consistencyN; i++) {
        const extra = await singlePass();
        runs.push({ answer: null, selected: extra.selected });
      }
      if (opts.generateAnswers) {
        for (const r of runs) {
          const g = await generateFor(r.selected);
          r.answer = g.answer;
          r.generation_ms = g.generation_ms;
        }
      }
      const mc = await require("./evalMetrics").measureConsistency(
        async (i) => ({ answer: runs[i].answer, selected: runs[i].selected }),
        { n: runs.length, embedFn: opts.consistencyEmbedFn }
      );
      agreement = mc.agreement;
      stability = mc.stability;
      consistencyRuns = runs;
    }

    let answer = null;
    let generation_ms = 0;
    if (opts.generateAnswers) {
      if (consistencyN >= 2) {
        // Primary answer is run 1 (already generated above for agreement).
        answer = consistencyRuns[0].answer;
        generation_ms = consistencyRuns[0].generation_ms || 0;
      } else {
        const g = await generateFor(pass.selected);
        answer = g.answer;
        generation_ms = g.generation_ms;
      }
    }

    const { selected, conflicts, debug, verdict, retrieval_ms, selection_ms } = pass;
    const selectedIds = selected.map((c, i) => chunkIdOf(c, i));
    const preferred = conflicts.length > 0 ? conflicts[0].preferredChunkId : null;
    const usableAnswer = answer && !answer.startsWith("ERROR:") ? answer : null;

    let faithfulness = null;
    let citation = null;
    let correctness = null;
    let correctnessReason = null;
    let f1 = null;
    let grounded = null;
    if (usableAnswer) {
      const evTexts = selected.map((c) => c.text || "");
      faithfulness = (await judgeFaithfulness(question.query, usableAnswer, evTexts, { fetchFn: opts.judgeFetchFn })).score;
      citation = (await judgeCitations(usableAnswer, selected, { judgeFn: opts.citationJudgeFn })).score;
      const cj = await judgeCorrectness(question.query, usableAnswer, question.expected_answer, { fetchFn: opts.judgeFetchFn });
      correctness = cj.score;
      correctnessReason = cj.reason;
      f1 = tokenF1(usableAnswer, question.expected_answer).f1;
      grounded = await judgeGroundedness(question.query, usableAnswer, selected, {
        fetchFn: opts.judgeFetchFn,
        judgeFn: opts.groundJudgeFn,
      });
    }

    return {
      question_id: question.id,
      precision_at_k: precisionAtK(selected, required, topK),
      recall_at_k: recallAtK(selected, required, topK),
      mrr: reciprocalRank(selected, required),
      ndcg: ndcgAtK(selected, required, topK),
      evidence_coverage: evidenceCoverage(selected, required),
      redundancy_rate: redundancyRate(selected, { similarityFn: opts.similarityFn }),
      conflict_correct: conflictCorrectness(question, { conflictsDetected: conflicts, preferredChunkId: preferred }),
      conflict_detected: conflicts.length > 0 ? 1 : 0,
      conflict_handled: conflictHandled(question, { conflictsDetected: conflicts, preferredChunkId: preferred, verdict }),
      latency_ms: Date.now() - t0,
      retrieval_ms,
      selection_ms,
      generation_ms,
      context_tokens: contextTokens(selected),
      selected_chunk_ids: selectedIds,
      answer_faithfulness: faithfulness,
      citation_accuracy: citation,
      answer: usableAnswer,
      answer_correct_judge: correctness,
      answer_correct_reason: correctnessReason,
      answer_token_f1: f1,
      grounded_supported_pct: grounded ? grounded.supported_pct : null,
      grounded_unsupported_pct: grounded ? grounded.unsupported_pct : null,
      citation_support_accuracy: grounded ? grounded.citation_accuracy : null,
      answer_agreement: agreement,
      retrieval_stability: stability,
      conflicts: conflicts.map((c) => ({ summary: c.summary, preferredChunkId: c.preferredChunkId })),
      debug,
      error: null,
    };
  } catch (err) {
    return {
      question_id: question.id,
      precision_at_k: 0, recall_at_k: 0, mrr: 0, ndcg: 0,
      evidence_coverage: 0, redundancy_rate: 0, conflict_correct: null,
      conflict_detected: 0, conflict_handled: null,
      latency_ms: Date.now() - t0, retrieval_ms: null, selection_ms: null, generation_ms: null,
      context_tokens: 0, selected_chunk_ids: [],
      answer_faithfulness: null, citation_accuracy: null, answer: null,
      answer_correct_judge: null, answer_correct_reason: null, answer_token_f1: null,
      grounded_supported_pct: null, grounded_unsupported_pct: null, citation_support_accuracy: null,
      answer_agreement: null, retrieval_stability: null,
      conflicts: [], debug: null,
      error: String(err.message || err).slice(0, 300),
    };
  }
}

function summarize(results) {
  const n = results.length;
  const avg = (f) => {
    const vals = results.map(f).filter((v) => typeof v === "number");
    if (vals.length === 0) return null;
    return parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(4));
  };
  const conflictVals = results.map((r) => r.conflict_correct).filter((v) => typeof v === "number");
  const handledVals = results.map((r) => r.conflict_handled).filter((v) => typeof v === "number");
  const pct = (vals, p) => {
    const xs = vals.filter((v) => typeof v === "number").sort((a, b) => a - b);
    if (xs.length === 0) return null;
    if (xs.length === 1) return xs[0];
    const rank = (p / 100) * (xs.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return parseFloat((lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (rank - lo)).toFixed(1));
  };
  const latVals = results.map((r) => r.latency_ms);
  const retVals = results.map((r) => r.retrieval_ms);
  const selVals = results.map((r) => r.selection_ms);
  const genVals = results.map((r) => r.generation_ms);
  return {
    n,
    avgPrecision: avg((r) => r.precision_at_k),
    avgRecall: avg((r) => r.recall_at_k),
    avgMRR: avg((r) => r.mrr),
    avgNDCG: avg((r) => r.ndcg),
    avgEvidenceCoverage: avg((r) => r.evidence_coverage),
    avgRedundancy: avg((r) => r.redundancy_rate),
    avgConflictCorrect: conflictVals.length > 0 ? parseFloat((conflictVals.reduce((s, v) => s + v, 0) / conflictVals.length).toFixed(4)) : null,
    conflictApplicable: conflictVals.length,
    avgConflictDetected: avg((r) => r.conflict_detected),
    avgConflictHandled: handledVals.length > 0 ? parseFloat((handledVals.reduce((s, v) => s + v, 0) / handledVals.length).toFixed(4)) : null,
    conflictHandledApplicable: handledVals.length,
    avgLatencyMs: avg((r) => r.latency_ms),
    latP50: pct(latVals, 50),
    latP95: pct(latVals, 95),
    avgRetrievalMs: avg((r) => r.retrieval_ms),
    avgSelectionMs: avg((r) => r.selection_ms),
    avgGenerationMs: avg((r) => r.generation_ms),
    avgContextTokens: avg((r) => r.context_tokens),
    avgFaithfulness: avg((r) => r.answer_faithfulness),
    avgCitation: avg((r) => r.citation_accuracy),
    avgCorrectness: avg((r) => r.answer_correct_judge),
    avgTokenF1: avg((r) => r.answer_token_f1),
    avgGroundedSupported: avg((r) => r.grounded_supported_pct),
    avgGroundedUnsupported: avg((r) => r.grounded_unsupported_pct),
    avgCitationSupport: avg((r) => r.citation_support_accuracy),
    avgAgreement: avg((r) => r.answer_agreement),
    avgStability: avg((r) => r.retrieval_stability),
    errors: results.filter((r) => r.error).length,
  };
}

/**
 * runEvaluation(opts) -> { runs, comparison, results }
 * opts: { methods, split='test', topK=5, datasetVersion='v1', config,
 *         generateAnswers=false, db, retrieve, ...assembler/judge passthrough }
 */
async function runEvaluation(opts = {}) {
  const db = opts.db || getDb();
  const methods = parseMethods(opts.methods);
  const split = opts.split || "test";
  const topK = Math.max(1, parseInt(opts.topK, 10) || 5);
  const datasetVersion = opts.datasetVersion || "v1";
  const questions = db.prepare("SELECT * FROM evaluation_questions WHERE split = ? ORDER BY id").all(split);
  if (questions.length === 0) throw new Error(`no evaluation questions in split "${split}" (import a dataset first)`);

  const insertRun = db.prepare("INSERT INTO evaluation_runs (method, config, dataset_version, timestamp) VALUES (?,?,?,?)");
  const insertRes = db.prepare(
    "INSERT INTO evaluation_results (run_id, question_id, precision_at_k, recall_at_k, mrr, ndcg, evidence_coverage, redundancy_rate, conflict_correct, latency_ms, context_tokens, selected_chunk_ids, answer_faithfulness, citation_accuracy, error, answer, answer_correct_judge, answer_correct_reason, answer_token_f1, grounded_supported_pct, grounded_unsupported_pct, citation_support_accuracy, answer_agreement, retrieval_stability, conflict_detected, conflict_handled, retrieval_ms, selection_ms, generation_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  );

  const runs = {};
  const comparison = {};
  const results = {};
  for (const m of methods) {
    const runInfo = insertRun.run(
      m,
      JSON.stringify({ mode: METHOD_MODES[m], topK, split, generateAnswers: !!opts.generateAnswers, ...(opts.config || {}) }),
      datasetVersion,
      new Date().toISOString()
    );
    const runId = Number(runInfo.lastInsertRowid);
    runs[m] = runId;
    const perQuestion = [];
    for (const q of questions) {
      const r = await evaluateQuestion(q, m, { ...opts, topK });
      perQuestion.push({ ...r, run_id: runId });
      insertRes.run(
        runId, r.question_id, r.precision_at_k, r.recall_at_k, r.mrr, r.ndcg,
        r.evidence_coverage, r.redundancy_rate, r.conflict_correct, r.latency_ms,
        r.context_tokens, JSON.stringify(r.selected_chunk_ids),
        r.answer_faithfulness, r.citation_accuracy, r.error, r.answer,
        r.answer_correct_judge, r.answer_correct_reason, r.answer_token_f1,
        r.grounded_supported_pct, r.grounded_unsupported_pct, r.citation_support_accuracy,
        r.answer_agreement, r.retrieval_stability,
        r.conflict_detected, r.conflict_handled,
        r.retrieval_ms, r.selection_ms, r.generation_ms
      );
    }
    results[m] = perQuestion;
    comparison[m] = { method: m, mode: METHOD_MODES[m], runId, ...summarize(perQuestion) };
  }
  return { runs, comparison, results, split, topK, datasetVersion, questionCount: questions.length };
}

module.exports = {
  METHOD_MODES,
  parseMethods,
  evaluateQuestion,
  runEvaluation,
  summarize,
};
