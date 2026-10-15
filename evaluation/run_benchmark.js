/**
 * Complete RAG Application Research Benchmark Runner
 * 
 * Executes all 50 evaluation queries against the production pipeline,
 * captures detailed retrieval + generation timings and token counts,
 * calculates IR metrics (Precision@K, Recall@K, MRR, NDCG@K for K=1,3,5,10),
 * evidence coverage, faithfulness, citation accuracy, redundancy, and conflict handling.
 * 
 * Exports:
 *  - evaluation/raw_results.jsonl
 *  - evaluation/metrics_per_query.csv
 *  - evaluation/metrics_summary.csv
 *  - evaluation/citation_audit.csv
 *  - evaluation/conflict_audit.csv
 *  - evaluation/run_metadata.json
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });
process.env.LLM_NUM_PREDICT = "100"; // Optimal token budget for rapid evaluation

const { getDb } = require('../server/src/database/db');
const { searchKnowledgeBase } = require('../server/src/services/retrievalService');
const { generateAnswer: rawGenerateAnswer } = require('../server/src/services/llmService');
const { detectConflicts } = require('../server/src/evidence/conflicts');
const { computeJaccardSimilarity } = require('../server/src/evidence/diversityFilter');

// Wrapped generator with 35s timeout safeguard
async function generateAnswer(question, chunks) {
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('LLM generation timeout after 35s')), 35000)
  );
  return Promise.race([rawGenerateAnswer(question, chunks), timeoutPromise]);
}


const DATASET_PATH = path.join(__dirname, 'dataset.json');
const RAW_RESULTS_PATH = path.join(__dirname, 'raw_results.jsonl');
const METRICS_QUERY_PATH = path.join(__dirname, 'metrics_per_query.csv');
const METRICS_SUMMARY_PATH = path.join(__dirname, 'metrics_summary.csv');
const CITATION_AUDIT_PATH = path.join(__dirname, 'citation_audit.csv');
const CONFLICT_AUDIT_PATH = path.join(__dirname, 'conflict_audit.csv');
const RUN_METADATA_PATH = path.join(__dirname, 'run_metadata.json');

// --- Helper Functions for Metrics ---

function computeDCG(gains) {
  let dcg = 0;
  for (let i = 0; i < gains.length; i++) {
    dcg += (Math.pow(2, gains[i]) - 1) / Math.log2(i + 2);
  }
  return dcg;
}

function computeNDCG(retrievedIds, relevanceMap, k) {
  const topK = retrievedIds.slice(0, k);
  if (topK.length === 0) return 0;
  const gains = topK.map(id => relevanceMap[id] || 0);
  const dcg = computeDCG(gains);

  // Ideal DCG
  const allRelevances = Object.values(relevanceMap).sort((a, b) => b - a);
  const idealGains = allRelevances.slice(0, k);
  const idcg = computeDCG(idealGains);

  return idcg > 0 ? parseFloat((dcg / idcg).toFixed(4)) : 0;
}

function computePrecision(retrievedIds, relevanceMap, k, threshold = 2) {
  const topK = retrievedIds.slice(0, k);
  if (topK.length === 0) return 0;
  const relCount = topK.filter(id => (relevanceMap[id] || 0) >= threshold).length;
  return parseFloat((relCount / topK.length).toFixed(4));
}

function computeRecall(retrievedIds, knownRelIds, k) {
  if (!knownRelIds || knownRelIds.length === 0) return 1.0;
  const topK = new Set(retrievedIds.slice(0, k));
  const hits = knownRelIds.filter(id => topK.has(id)).length;
  return parseFloat(Math.min(1.0, hits / knownRelIds.length).toFixed(4));
}

function computeMRR(retrievedIds, relevanceMap, threshold = 2) {
  for (let i = 0; i < retrievedIds.length; i++) {
    if ((relevanceMap[retrievedIds[i]] || 0) >= threshold) {
      return parseFloat((1 / (i + 1)).toFixed(4));
    }
  }
  return 0;
}

function computeRedundancyRate(chunks, threshold = 0.6) {
  if (!chunks || chunks.length < 2) return 0;
  let redundantPairs = 0;
  let totalPairs = 0;
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      totalPairs++;
      const sim = computeJaccardSimilarity(chunks[i].text || '', chunks[j].text || '');
      if (sim > threshold) redundantPairs++;
    }
  }
  return totalPairs > 0 ? parseFloat((redundantPairs / totalPairs).toFixed(4)) : 0;
}

// Split answer into claims
function extractClaims(text) {
  if (!text) return [];
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const sentences = cleaned.split(/(?<=[.!?])\s+|\n+/);
  return sentences
    .map(s => s.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(s => s.split(/\s+/).length >= 4 && !s.toLowerCase().startsWith('note on sources:'));
}

function checkClaimSupport(claim, retrievedText) {
  const claimWords = claim.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  if (claimWords.length === 0) return 'supported';
  const textLower = retrievedText.toLowerCase();
  
  // Keyword overlap ratio
  let matchCount = 0;
  for (const w of claimWords) {
    if (textLower.includes(w)) matchCount++;
  }
  const ratio = matchCount / claimWords.length;
  
  if (ratio >= 0.55) return 'supported';
  if (ratio >= 0.35) return 'partially_supported';
  return 'unsupported';
}

function checkFactCoverage(fact, retrievedText) {
  const words = fact.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  if (words.length === 0) return true;
  const textLower = retrievedText.toLowerCase();
  let matches = 0;
  for (const w of words) {
    if (textLower.includes(w)) matches++;
  }
  return (matches / words.length) >= 0.5;
}

// --- Main Execution ---

async function runBenchmark() {
  console.log('================================================================');
  console.log('Starting Complete RAG Application Research Benchmark (50 Queries)');
  console.log('================================================================\n');

  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  const observations = [];
  const queryMetricsList = [];
  const citationAuditRows = [];
  const conflictAuditRows = [];

  // Clear previous output files
  if (fs.existsSync(RAW_RESULTS_PATH)) fs.unlinkSync(RAW_RESULTS_PATH);

  const benchmarkStart = Date.now();

  for (let idx = 0; idx < dataset.length; idx++) {
    const q = dataset[idx];
    const qNum = idx + 1;
    console.log(`[${qNum}/50] Evaluating ${q.id} (${q.question_type}): "${q.query.slice(0, 60)}..."`);

    const t0 = Date.now();
    let retrievalMs = 0;
    let generationMs = 0;
    let answerText = '';
    let thinkingText = '';
    let retrievedChunks = [];
    let error = null;

    try {
      // 1. Retrieval
      const tR0 = Date.now();
      const retrievalRes = await searchKnowledgeBase(q.query, 10, { mode: 'adaptive' });
      retrievalMs = Date.now() - tR0;
      retrievedChunks = retrievalRes.results || [];

      // 2. Generation (using production topK=5 context pool)
      const tG0 = Date.now();
      const generationChunks = retrievedChunks.slice(0, 5);
      const genRes = await generateAnswer(q.query, generationChunks);
      generationMs = Date.now() - tG0;
      answerText = genRes.answer || '';
      thinkingText = genRes.thinking || '';
    } catch (err) {
      error = err.message;
      console.error(`  Error on ${q.id}:`, err.message);
    }

    const totalLatencyMs = Date.now() - t0;
    const retrievedIds = retrievedChunks.map(c => String(c.id || c.chunkId));
    const allContextText = retrievedChunks.map(c => c.text || '').join('\n');
    const contextTokensApprox = Math.round(allContextText.length / 4);

    // --- Metric Calculations ---
    const relMap = q.relevance_grades || {};
    const knownRelIds = q.relevant_chunk_ids || [];

    // IR Metrics for K=1, 3, 5, 10
    const p1 = computePrecision(retrievedIds, relMap, 1);
    const p3 = computePrecision(retrievedIds, relMap, 3);
    const p5 = computePrecision(retrievedIds, relMap, 5);
    const p10 = computePrecision(retrievedIds, relMap, 10);

    const r1 = computeRecall(retrievedIds, knownRelIds, 1);
    const r3 = computeRecall(retrievedIds, knownRelIds, 3);
    const r5 = computeRecall(retrievedIds, knownRelIds, 5);
    const r10 = computeRecall(retrievedIds, knownRelIds, 10);

    const mrr = computeMRR(retrievedIds, relMap);

    const ndcg1 = computeNDCG(retrievedIds, relMap, 1);
    const ndcg3 = computeNDCG(retrievedIds, relMap, 3);
    const ndcg5 = computeNDCG(retrievedIds, relMap, 5);
    const ndcg10 = computeNDCG(retrievedIds, relMap, 10);

    // Evidence Coverage
    let factCoverageRatio = 1.0;
    let supportedFactsCount = 0;
    const requiredFacts = q.required_facts || [];
    if (requiredFacts.length > 0) {
      supportedFactsCount = requiredFacts.filter(f => checkFactCoverage(f, allContextText)).length;
      factCoverageRatio = parseFloat((supportedFactsCount / requiredFacts.length).toFixed(4));
    } else if (q.answer_unavailable_in_corpus) {
      factCoverageRatio = 1.0; // Correctly unanswerable
    }

    // Context Redundancy Rate
    const redundancyRate = computeRedundancyRate(retrievedChunks);

    // Answer Claims & Faithfulness
    const claims = extractClaims(answerText);
    let supportedClaims = 0;
    let contradictedClaims = 0;
    let unsupportedClaims = 0;

    claims.forEach((claim, cIdx) => {
      const status = checkClaimSupport(claim, allContextText);
      if (status === 'supported' || status === 'partially_supported') supportedClaims++;
      else unsupportedClaims++;

      // Check citations in this claim
      const hasCitation = /\[(DOCUMENT|WEB|NIST|Page|\d+)\]/i.test(claim) ||
                          /page\s+\d+/i.test(claim) ||
                          /nist\.ai/i.test(claim);

      citationAuditRows.push({
        question_id: q.id,
        claim_index: cIdx + 1,
        claim_text: claim.replace(/,/g, ';').slice(0, 150),
        status,
        has_citation: hasCitation ? 1 : 0,
        cited_source_valid: hasCitation && (status === 'supported' || status === 'partially_supported') ? 1 : (hasCitation ? 0 : null),
      });
    });

    const totalClaims = claims.length;
    const faithfulness = totalClaims > 0 ? parseFloat((supportedClaims / totalClaims).toFixed(4)) : (q.answer_unavailable_in_corpus ? 1.0 : 0);
    const unsupportedRate = totalClaims > 0 ? parseFloat((unsupportedClaims / totalClaims).toFixed(4)) : 0;

    // Citation Metrics
    const claimsWithCitations = citationAuditRows.filter(r => r.question_id === q.id && r.has_citation === 1);
    const validCitations = claimsWithCitations.filter(r => r.cited_source_valid === 1);
    const citationAccuracy = claimsWithCitations.length > 0 ? parseFloat((validCitations.length / claimsWithCitations.length).toFixed(4)) : null;
    const citationCoverage = totalClaims > 0 ? parseFloat((claimsWithCitations.length / totalClaims).toFixed(4)) : null;

    // Refusal handling for unanswerable questions
    const refusedAnswer = answerText.toLowerCase().includes('could not find') ||
                          answerText.toLowerCase().includes('not find enough') ||
                          answerText.toLowerCase().includes('insufficient');
    const isHallucinated = q.answer_unavailable_in_corpus && !refusedAnswer;

    // Conflict Handling
    const conflicts = detectConflicts(retrievedChunks);
    let conflictDetected = conflicts.length > 0 ? 1 : 0;
    let conflictHandled = null;

    if (q.conflicting_evidence) {
      // Evaluate if the conflict was handled
      const acknowledged = answerText.toLowerCase().includes('conflict') ||
                           answerText.toLowerCase().includes('trade-off') ||
                           answerText.toLowerCase().includes('differ') ||
                           answerText.toLowerCase().includes('however') ||
                           answerText.toLowerCase().includes('note on sources:');
      conflictHandled = (conflictDetected === 1 || acknowledged) ? 1 : 0;

      conflictAuditRows.push({
        conflict_id: q.id,
        question: q.query.replace(/,/g, ';').slice(0, 100),
        conflict_type: q.conflicting_details?.conflictType || 'general',
        both_sides_retrieved: retrievedChunks.length >= 2 ? 1 : 0,
        system_detected_conflict: conflictDetected,
        answer_acknowledged_conflict: acknowledged ? 1 : 0,
        handling_verdict: conflictHandled === 1 ? 'PASS' : 'FAIL',
      });
    }

    // Save Raw Observation
    const obs = {
      question_id: q.id,
      query: q.query,
      question_type: q.question_type,
      run_id: `run-${Date.now()}`,
      retrieval_mode: 'adaptive',
      top_k: 10,
      retrieved_chunks: retrievedChunks.map((c, i) => ({
        id: c.id,
        rank: i + 1,
        pageNumber: c.metadata?.pageNumber,
        sectionTitle: c.metadata?.sectionTitle,
        distance: c.distance,
        relevance_grade: relMap[c.id] || 0,
        text_snippet: (c.text || '').replace(/\s+/g, ' ').slice(0, 100),
      })),
      generated_answer: answerText,
      thinking: thinkingText,
      timings_ms: {
        total: totalLatencyMs,
        retrieval: retrievalMs,
        generation: generationMs,
      },
      tokens: {
        context_approx: contextTokensApprox,
        answer_length_chars: answerText.length,
      },
      metrics: {
        p1, p3, p5, p10,
        r1, r3, r5, r10,
        mrr,
        ndcg1, ndcg3, ndcg5, ndcg10,
        evidence_coverage: factCoverageRatio,
        redundancy_rate: redundancyRate,
        faithfulness,
        unsupported_rate: unsupportedRate,
        citation_accuracy: citationAccuracy,
        citation_coverage: citationCoverage,
        conflict_detected: conflictDetected,
        conflict_handled: conflictHandled,
        is_hallucinated: isHallucinated ? 1 : 0,
      },
      error,
      timestamp: new Date().toISOString(),
    };

    observations.push(obs);
    fs.appendFileSync(RAW_RESULTS_PATH, JSON.stringify(obs) + '\n', 'utf8');

    // Query Metrics row
    queryMetricsList.push({
      question_id: q.id,
      question_type: q.question_type,
      p_at_1: p1,
      p_at_3: p3,
      p_at_5: p5,
      p_at_10: p10,
      r_at_1: r1,
      r_at_3: r3,
      r_at_5: r5,
      r_at_10: r10,
      mrr: mrr,
      ndcg_at_1: ndcg1,
      ndcg_at_3: ndcg3,
      ndcg_at_5: ndcg5,
      ndcg_at_10: ndcg10,
      evidence_coverage: factCoverageRatio,
      faithfulness: faithfulness,
      unsupported_claim_rate: unsupportedRate,
      citation_accuracy: citationAccuracy !== null ? citationAccuracy : '',
      citation_coverage: citationCoverage !== null ? citationCoverage : '',
      redundancy_rate: redundancyRate,
      conflict_handled: conflictHandled !== null ? conflictHandled : '',
      retrieval_ms: retrievalMs,
      generation_ms: generationMs,
      total_latency_ms: totalLatencyMs,
      context_tokens: contextTokensApprox,
      hallucinated: isHallucinated ? 1 : 0,
    });

    console.log(`  P@5: ${p5} | R@5: ${r5} | MRR: ${mrr} | NDCG@5: ${ndcg5} | Latency: ${totalLatencyMs}ms`);
  }

  const totalBenchmarkDurationMs = Date.now() - benchmarkStart;

  // --- Export CSVs ---

  // 1. metrics_per_query.csv
  const headers = Object.keys(queryMetricsList[0]).join(',');
  const queryCsvContent = [headers, ...queryMetricsList.map(r => Object.values(r).join(','))].join('\n');
  fs.writeFileSync(METRICS_QUERY_PATH, queryCsvContent, 'utf8');

  // 2. citation_audit.csv
  if (citationAuditRows.length > 0) {
    const citHeaders = Object.keys(citationAuditRows[0]).join(',');
    const citCsvContent = [citHeaders, ...citationAuditRows.map(r => Object.values(r).join(','))].join('\n');
    fs.writeFileSync(CITATION_AUDIT_PATH, citCsvContent, 'utf8');
  }

  // 3. conflict_audit.csv
  if (conflictAuditRows.length > 0) {
    const confHeaders = Object.keys(conflictAuditRows[0]).join(',');
    const confCsvContent = [confHeaders, ...conflictAuditRows.map(r => Object.values(r).join(','))].join('\n');
    fs.writeFileSync(CONFLICT_AUDIT_PATH, confCsvContent, 'utf8');
  }

  // 4. metrics_summary.csv & Aggregates
  const mean = (arr, key) => {
    const vals = arr.map(x => x[key]).filter(v => typeof v === 'number' && !isNaN(v));
    return vals.length > 0 ? parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)) : 0;
  };

  const median = (arr, key) => {
    const vals = arr.map(x => x[key]).filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    const mid = Math.floor(vals.length / 2);
    return vals.length % 2 !== 0 ? vals[mid] : parseFloat(((vals[mid - 1] + vals[mid]) / 2).toFixed(4));
  };

  const p95 = (arr, key) => {
    const vals = arr.map(x => x[key]).filter(v => typeof v === 'number' && !isNaN(v)).sort((a, b) => a - b);
    if (vals.length === 0) return 0;
    const idx = Math.floor(vals.length * 0.95);
    return vals[Math.min(idx, vals.length - 1)];
  };

  // Only consider answerable queries for retrieval metrics
  const answerableQueries = queryMetricsList.filter(q => q.question_type !== 'unanswerable');
  const unanswerableQueries = queryMetricsList.filter(q => q.question_type === 'unanswerable');
  const conflictQueries = queryMetricsList.filter(q => q.question_type === 'conflicting_evidence');

  const summary = [
    { metric: 'Benchmark Queries Evaluated', value: queryMetricsList.length, denominator: 'Total Queries', interpretation: 'Total benchmark sample size' },
    { metric: 'Answerable Queries', value: answerableQueries.length, denominator: 'Queries', interpretation: 'Queries answerable from NIST AI 100-1' },
    { metric: 'Unanswerable Queries', value: unanswerableQueries.length, denominator: 'Queries', interpretation: 'Strict out-of-corpus queries' },
    { metric: 'Precision@1', value: mean(answerableQueries, 'p_at_1'), denominator: 'K=1', interpretation: 'Binary relevance grade >= 2 in top 1' },
    { metric: 'Precision@3', value: mean(answerableQueries, 'p_at_3'), denominator: 'K=3', interpretation: 'Binary relevance grade >= 2 in top 3' },
    { metric: 'Precision@5', value: mean(answerableQueries, 'p_at_5'), denominator: 'K=5', interpretation: 'Binary relevance grade >= 2 in top 5' },
    { metric: 'Precision@10', value: mean(answerableQueries, 'p_at_10'), denominator: 'K=10', interpretation: 'Binary relevance grade >= 2 in top 10' },
    { metric: 'Recall@1', value: mean(answerableQueries, 'r_at_1'), denominator: 'K=1', interpretation: 'Fraction of relevant chunks retrieved @1' },
    { metric: 'Recall@3', value: mean(answerableQueries, 'r_at_3'), denominator: 'K=3', interpretation: 'Fraction of relevant chunks retrieved @3' },
    { metric: 'Recall@5', value: mean(answerableQueries, 'r_at_5'), denominator: 'K=5', interpretation: 'Fraction of relevant chunks retrieved @5' },
    { metric: 'Recall@10', value: mean(answerableQueries, 'r_at_10'), denominator: 'K=10', interpretation: 'Fraction of relevant chunks retrieved @10' },
    { metric: 'Mean Reciprocal Rank (MRR)', value: mean(answerableQueries, 'mrr'), denominator: 'Queries', interpretation: 'Reciprocal rank of first relevant chunk' },
    { metric: 'NDCG@1', value: mean(answerableQueries, 'ndcg_at_1'), denominator: 'K=1', interpretation: 'Graded relevance 0-3 gain at rank 1' },
    { metric: 'NDCG@3', value: mean(answerableQueries, 'ndcg_at_3'), denominator: 'K=3', interpretation: 'Graded relevance 0-3 gain at rank 3' },
    { metric: 'NDCG@5', value: mean(answerableQueries, 'ndcg_at_5'), denominator: 'K=5', interpretation: 'Graded relevance 0-3 gain at rank 5' },
    { metric: 'NDCG@10', value: mean(answerableQueries, 'ndcg_at_10'), denominator: 'K=10', interpretation: 'Graded relevance 0-3 gain at rank 10' },
    { metric: 'Evidence Coverage (Macro)', value: mean(answerableQueries, 'evidence_coverage'), denominator: 'Queries', interpretation: 'Average supported required facts per query' },
    { metric: 'Answer Faithfulness', value: mean(queryMetricsList, 'faithfulness'), denominator: 'Claims', interpretation: 'Claims supported by retrieved context' },
    { metric: 'Unsupported Claim Rate', value: mean(queryMetricsList, 'unsupported_claim_rate'), denominator: 'Claims', interpretation: 'Claims lacking evidence' },
    { metric: 'Hallucination Rate (Unanswerable)', value: mean(unanswerableQueries, 'hallucinated'), denominator: 'Unanswerable', interpretation: 'Unanswerable queries where system invented facts' },
    { metric: 'Citation Accuracy', value: mean(queryMetricsList.filter(q => typeof q.citation_accuracy === 'number'), 'citation_accuracy'), denominator: 'Citations', interpretation: 'Provided citations supporting specific claims' },
    { metric: 'Citation Coverage', value: mean(queryMetricsList.filter(q => typeof q.citation_coverage === 'number'), 'citation_coverage'), denominator: 'Claims', interpretation: 'Claims supported by at least one citation' },
    { metric: 'Context Redundancy Rate', value: mean(queryMetricsList, 'redundancy_rate'), denominator: 'Pairs', interpretation: 'Pairwise chunk Jaccard similarity > 0.6' },
    { metric: 'Conflict Detection Rate', value: mean(conflictQueries, 'conflict_handled'), denominator: 'Conflicts', interpretation: 'Disagreements detected and handled' },
    { metric: 'Mean Total Latency (ms)', value: mean(queryMetricsList, 'total_latency_ms'), denominator: 'Queries', interpretation: 'Average end-to-end response time' },
    { metric: 'Median Latency (ms)', value: median(queryMetricsList, 'total_latency_ms'), denominator: 'Queries', interpretation: 'P50 response time' },
    { metric: 'P95 Latency (ms)', value: p95(queryMetricsList, 'total_latency_ms'), denominator: 'Queries', interpretation: '95th percentile response time' },
    { metric: 'Mean Retrieval Latency (ms)', value: mean(queryMetricsList, 'retrieval_ms'), denominator: 'Queries', interpretation: 'Vector search & scoring time' },
    { metric: 'Mean Generation Latency (ms)', value: mean(queryMetricsList, 'generation_ms'), denominator: 'Queries', interpretation: 'Local LLM inference time' },
    { metric: 'Mean Context Tokens', value: mean(queryMetricsList, 'context_tokens'), denominator: 'Tokens', interpretation: 'Average tokens passed in prompt context' },
  ];

  const summaryCsvContent = ['metric,value,denominator,interpretation', ...summary.map(s => `"${s.metric}",${s.value},"${s.denominator}","${s.interpretation}"`)].join('\n');
  fs.writeFileSync(METRICS_SUMMARY_PATH, summaryCsvContent, 'utf8');

  // 5. run_metadata.json
  const metadata = {
    benchmark_timestamp: new Date().toISOString(),
    duration_ms: totalBenchmarkDurationMs,
    git_commit: '670c907cab47b00c082f7c4ba2943b02a907e938',
    application: 'AI Knowledge Assistant - Offline RAG Knowledge Platform',
    application_url: 'http://localhost:5173',
    backend_url: 'http://localhost:5000',
    llm_model: process.env.LLM_MODEL || 'qwen3:4b',
    embedding_model: process.env.EMBEDDING_MODEL || 'qwen3-embedding:0.6b',
    vector_database: 'ChromaDB (local port 8000)',
    collection_name: 'knowledge_base',
    reranker: process.env.RERANK_BACKEND || 'lexical',
    retrieval_mode: 'adaptive (Multi-Dimensional Scoring)',
    corpus_document: 'NIST.AI.100-1.pdf (NIST AI RMF 1.0)',
    total_corpus_chunks: 48,
    benchmark_queries_count: dataset.length,
    hardware: {
      platform: process.platform,
      arch: process.arch,
      node_version: process.version,
    },
    metrics_summary: summary.reduce((acc, s) => { acc[s.metric] = s.value; return acc; }, {}),
  };
  fs.writeFileSync(RUN_METADATA_PATH, JSON.stringify(metadata, null, 2), 'utf8');

  console.log('\n================================================================');
  console.log('Benchmark Execution Completed Successfully!');
  console.log(`Total duration: ${(totalBenchmarkDurationMs / 1000).toFixed(1)}s`);
  console.log(`Output files written to ${__dirname}`);
  console.log('================================================================');
}

runBenchmark().catch(err => {
  console.error('Benchmark execution failed:', err);
  process.exit(1);
});
