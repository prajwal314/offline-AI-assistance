/**
 * Manual-review export: deterministic sample of evaluated questions with
 * answers, cited chunk texts, and judge verdicts, so a human can verify
 * judge accuracy by hand. JSON + markdown formats.
 */

const { getDb } = require("../database/db");

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseIds(v) {
  try {
    const parsed = typeof v === "string" ? JSON.parse(v) : v;
    return (Array.isArray(parsed) ? parsed : []).map(String);
  } catch { return []; }
}

async function defaultFetchChunks(ids) {
  try {
    const { getCollection } = require("../services/chromaService");
    const col = await getCollection();
    const res = await col.get({ ids });
    const out = {};
    (res.ids || []).forEach((id, i) => {
      out[String(id)] = {
        text: (res.documents || [])[i] || "",
        metadata: ((res.metadatas || [])[i]) || {},
      };
    });
    return out;
  } catch {
    return {};
  }
}

/**
 * sampleReview({ db, runId, n=20, seed=7, fetchChunks })
 * runId omitted -> most recent run. Returns { run_id, method, sampled: [...] }.
 */
async function sampleReview(opts = {}) {
  const db = opts.db || getDb();
  let runId = opts.runId != null ? Number(opts.runId) : null;
  if (!runId) {
    const latest = db.prepare("SELECT id FROM evaluation_runs ORDER BY id DESC LIMIT 1").get();
    if (!latest) throw new Error("no evaluation runs yet");
    runId = latest.id;
  }
  const run = db.prepare("SELECT * FROM evaluation_runs WHERE id = ?").get(runId);
  if (!run) throw new Error(`evaluation run ${runId} not found`);
  const rows = db.prepare(
    `SELECT r.*, q.query, q.question_type, q.split, q.expected_answer
     FROM evaluation_results r
     JOIN evaluation_questions q ON q.id = r.question_id
     WHERE r.run_id = ? ORDER BY r.question_id`
  ).all(runId);
  if (rows.length === 0) throw new Error(`run ${runId} has no results`);

  const n = Math.max(1, parseInt(opts.n, 10) || 20);
  const rnd = mulberry32(Number(opts.seed ?? 7));
  const order = rows.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const picked = order.slice(0, Math.min(n, rows.length)).map((i) => rows[i]);

  const wanted = new Set();
  for (const r of picked) for (const id of parseIds(r.selected_chunk_ids)) wanted.add(id);
  const fetchChunks = opts.fetchChunks || defaultFetchChunks;
  const chunkMap = await fetchChunks([...wanted]);

  return {
    run_id: runId,
    method: run.method,
    sampled: picked.map((r) => ({
      question_id: r.question_id,
      query: r.query,
      question_type: r.question_type,
      expected_answer: r.expected_answer,
      answer: r.answer,
      selected_chunks: parseIds(r.selected_chunk_ids).map((id) => ({
        chunk_id: id,
        text: (chunkMap[id] && chunkMap[id].text) || "",
      })),
      judge: {
        correctness: r.answer_correct_judge,
        correctness_reason: r.answer_correct_reason,
        token_f1: r.answer_token_f1,
        faithfulness: r.answer_faithfulness,
        grounded_supported_pct: r.grounded_supported_pct,
        grounded_unsupported_pct: r.grounded_unsupported_pct,
        citation_accuracy: r.citation_accuracy,
        citation_support_accuracy: r.citation_support_accuracy,
      },
      retrieval: {
        precision_at_k: r.precision_at_k,
        recall_at_k: r.recall_at_k,
        evidence_coverage: r.evidence_coverage,
        conflict_detected: r.conflict_detected,
        conflict_handled: r.conflict_handled,
      },
    })),
  };
}

function reviewMarkdown(sample) {
  const lines = [
    `# Manual review — run ${sample.run_id} (method ${sample.method})`,
    "",
    `Sampled ${sample.sampled.length} question(s). Judge cells are approximations — verify by hand.`,
    "",
  ];
  sample.sampled.forEach((s, i) => {
    lines.push(`## ${i + 1}. Q${s.question_id} [${s.question_type}]`, "", `**Q:** ${s.query}`, "", `**Expected:** ${s.expected_answer || "(none labelled)"}`, "", `**Answer:** ${s.answer || "(none generated)"}`, "");
    lines.push(`**Cited chunks:**`);
    if (s.selected_chunks.length === 0) lines.push("(none)");
    for (const c of s.selected_chunks) {
      lines.push(`- [${c.chunk_id}] ${(c.text || "(text unavailable)").slice(0, 400)}`);
    }
    lines.push("", `**Judge verdicts:** correctness=${s.judge.correctness ?? "n/a"} (${s.judge.correctness_reason || "no reason"}) | tokenF1=${s.judge.token_f1 ?? "n/a"} | faithful=${s.judge.faithfulness ?? "n/a"} | grounded+=${s.judge.grounded_supported_pct ?? "n/a"} grounded-=${s.judge.grounded_unsupported_pct ?? "n/a"} | cite=${s.judge.citation_accuracy ?? "n/a"} citeSupport=${s.judge.citation_support_accuracy ?? "n/a"}`, "");
    lines.push(`**Your verdict:** [ ] judge right · [ ] judge wrong — notes: ____`, "");
  });
  return lines.join("\n");
}

module.exports = { sampleReview, reviewMarkdown };
