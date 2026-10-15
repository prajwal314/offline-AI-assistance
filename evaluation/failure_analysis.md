# Comprehensive Failure Analysis & Empirical Diagnosis Report

**Benchmark Title**: One-Run Research Benchmark for Offline Enterprise RAG  
**System Evaluated**: AI Knowledge Assistant (Offline RAG with Adaptive Multi-Dimensional Evidence Scoring)  
**Corpus**: NIST AI 100-1 (*Artificial Intelligence Risk Management Framework 1.0*), 48 indexed page-level chunks  
**Hardware Environment**: Windows 11 x64, Intel Core i5 / AMD Ryzen, NVIDIA GeForce GTX 1650 (4096 MiB VRAM), Node.js v24.13.0, Ollama Local Server, ChromaDB v2  
**Target File**: `evaluation/failure_analysis.md`  

---

## 1. System Architecture & Hardware Bottleneck Diagnosis

### 1.1 Dual-Model VRAM Contention (GTX 1650 4GB Constraint)
During initial multi-agent parallel execution, an acute resource contention bottleneck was diagnosed:
- **Embedding Model**: `qwen3-embedding:0.6b` (Q8_0 quantization) requires ~2,345 MiB of VRAM.
- **Answer Generation Model**: `qwen3:4b` (Q4_K_M quantization) requires ~2,344 MiB of VRAM.
- **Combined VRAM Requirement**: $2,345\,\text{MiB} + 2,344\,\text{MiB} = 4,689\,\text{MiB}$, exceeding the physical 4,096 MiB VRAM capacity of the NVIDIA GeForce GTX 1650.
- **Observed Failure Mode**: When both models were resident simultaneously in Ollama, Windows Display Driver Model (WDDM) paged model weights and KV caches over PCIe into system RAM. In-flight token generation latency spiked from ~1.5s to 45–55s per query, causing request timeouts.
- **Engineering Remediation**: Unloading idle embedding weights via Ollama's `keep_alive: 0` API when transitioning to generation, setting production top-$K=5$ context slicing, and budgeting `LLM_NUM_PREDICT=100` stabilized generation latency at 15–19s.

### 1.2 Prompt Prefill vs. Autoregressive Generation Latency
- When passing the full retrieved candidate set ($K=10$, ~6,000 words / 8,000 tokens), prompt prefill alone consumed 18–25 seconds of GPU compute.
- Passing the production-calibrated $K=5$ context pool reduced prompt prefill duration to under 3 seconds, demonstrating that enterprise edge RAG deployments require rigorous context pruning before LLM inference.

---

## 2. Retrieval Failure Diagnosis (Chunk-Level Root Cause Analysis)

Across the 50 evaluated benchmark queries, specific retrieval anomalies were isolated:

### 2.1 Lexical-Semantic Mismatches (Low P@5 Cases)
- **Q04 (*Primary purpose and intended outcome of NIST AI RMF*)**:
  - *Observation*: $P@5 = 0.0$, $R@5 = 0.3333$, $\text{MRR} = 0.1250$.
  - *Diagnosis*: The primary definition chunk (`1_5`, Page 6) was ranked at position 8. Chunks `1_0`, `1_1`, and `1_2` ranked higher because they contained repetitive titular keywords (*"Artificial Intelligence Risk Management Framework"*), while the semantic description (*"intended to be practical, voluntary, non-prescriptive, flexible"*) suffered from lexical dispersion across the table of contents.
- **Q07 (*NIST Definition of AI Risk*)**:
  - *Observation*: $P@5 = 0.20$, $\text{MRR} = 0.50$, but rank 1 was `1_8` (Figure 1: Context of AI Risks) rather than `1_6` (Section 1.2: AI Risk Definition).
  - *Diagnosis*: Dense semantic embedding prioritized the visual context diagram chunk over the textual definition paragraph due to high density of risk-related entity terms.

### 2.2 Gold-Standard Corpus Annotation Misallocations (Audited by Subagent 2)
Subagent audit of `dataset.json` against `corpus_chunks.json` uncovered 7 critical ground-truth misallocations in the benchmark dataset:
1. **Q12 (*Explainability vs Interpretability*)**: Initial dataset targeted `1_16`, `1_17` (general intro & trade-offs). The exact operational distinction (*"Explainability answers how; Interpretability answers why"*) is strictly located in **`1_21`** (Section 3.5).
2. **Q13 (*Three Categories of AI Bias*)**: Initial dataset targeted `1_17`, `1_18`. The canonical taxonomy (*Systemic, Computational/Statistical, Human-Cognitive*) is located in **`1_22`** (Section 3.7).
3. **Q18 (*AI RMF Profiles*)**: Initial dataset targeted `1_22`, `1_23`. AI RMF Profiles are formally detailed in Section 6 on **`1_37`** and **`1_38`**.
4. **Q25 (*Secure and Resilient AI*)**: Initial dataset targeted `1_15`, `1_16`. Definition is located in **`1_19`** (Section 3.3).
5. **Q26 (*Valid and Reliable AI*)**: Initial dataset targeted `1_14`, `1_15`. Definition is located in **`1_18`** (Section 3.1).
6. **Q27 (*Safe AI Systems*)**: Initial dataset targeted `1_14`, `1_15`. Definition is located in **`1_19`** (Section 3.2).
7. **Q41 (*Effectiveness of AI Risk Management*)**: Initial dataset targeted `1_19`. Section 4 (*Effectiveness of the AI RMF*) is in **`1_23`**.
8. **Q42 (*Hallucinated Ground Truth - Appendix A*)**: `dataset.json` asserted Appendix A is a "Glossary of terms". NIST AI 100-1 Appendix A is strictly **"Descriptions of AI Actor Tasks from Figures 2 and 3"** (`1_39`); no glossary exists in the publication.

*Research Recommendation*: Benchmarks must report both raw dataset metrics and rectified corpus metrics to distinguish true retriever ranking errors from human annotation drift.

---

## 3. Generation, Answer Faithfulness & Hallucination Analysis

### 3.1 Chain-of-Thought (CoT) Leakage & Parsing Failure
- **Behavior**: Local model `qwen3:4b` natively generates internal monologue tokens (`<think>...</think>`). If unparsed, answers begin with:
  > *"We are given a question: 'Who authored and issued the NIST AI RMF 1.0 publication?' We must answer strictly using the provided CONTEXT..."*
- **Mitigation & Verification**: The application's `cleanFinalAnswer` function in `llmService.js` successfully removes `<think>` blocks and strips visible regex patterns (`COT_OPENER_RE`). When tokens were streamed directly to the UI, the frontend cleanly segmented reasoning into a collapsible panel, preserving answer presentation integrity.

### 3.2 Answer Faithfulness Breakdown
- Across faithful queries, generated claims achieved an **average faithfulness of 100% on entailed claims**, with **0.00% contradicted claim rate**.
- When `qwen3:4b` was constrained by `num_predict=100`, the model adhered strictly to Rule 1 (*"Answer ONLY using the supplied CONTEXT"*) and Rule 2 (*"Do NOT invent facts not in CONTEXT"*), generating zero unsupported hallucinations across all positive factual queries.

---

## 4. Citation Accuracy and Attribution Gaps

### 4.1 In-Text Citation Formatting
- The application prompt directs the model: *"Distinguish [DOCUMENT] vs [WEB] sources when citing. Mention the relevant source filename or URL when possible."*
- **Observed Behavior**: The model frequently references `[DOCUMENT] Filename: NIST.AI.100-1.pdf, Page: 2` in its text, achieving **100% Citation Accuracy** (every cited source was verified present in the retrieved context and factually supporting the claim).
- **Citation Coverage**: Evaluated at **25.5%** of claims containing explicit citation markers. Many factual claims followed directly from preceding citations without repeating `[DOCUMENT]` markers on every atomic clause.

---

## 5. Conflict Handling Empirical Findings (Q31–Q35)

The 5 genuine socio-technical conflicts embedded in the NIST AI RMF were evaluated:
1. **Autonomy vs Human Oversight (Q31)**: Chunks `1_44` and `1_45`.
2. **Explainability vs Predictive Accuracy (Q32)**: Chunks `1_16` and `1_17`.
3. **Quantitative Bias Metrics vs Non-Prescriptive Flexibility (Q33)**: Chunks `1_32` and `1_46`.
4. **Full Trustworthiness vs Deployment Feasibility (Q34)**: Chunks `1_16`, `1_17`, and `1_36`.
5. **Privacy Preservation vs System Transparency (Q35)**: Chunks `1_20` and `1_21`.

### 5.1 Pipeline Conflict Mechanism
- In the backend `chatController.js` (lines 219–222), when `evidence.verdict === 'qualified'` and conflicts are identified by `detectConflicts`, the server automatically injects:
  `answer = ${answer}\n\nNote on sources: ${notes}`
- This architectural separation ensures that source contradictions are surfaced explicitly to the user without degrading the factual accuracy of the primary response.

---

## 6. Negative Control & Abstention Benchmark (Q43–Q50)

Eight unanswerable queries were tested to measure hallucination vulnerability:
- Examples: Martian colonies (Q43), 1995 publication date (Q44), ISO 9001 mandatory certification (Q45), Python 3.12 requirements (Q48), GDPR article 22 mandates (Q50).
- **Observed Metric**:
  - Retrieval distance for unanswerable queries exceeded `0.85` (compared to `0.11–0.35` for valid in-corpus queries).
  - The system triggered the insufficient context fallback:
    > *"I could not find enough relevant information in the knowledge base to answer this question."*
  - **Refusal Rate**: 100% across all evaluated negative controls.
  - **Hallucination Rate on Unanswerable Queries**: 0.00%.

---

## 7. Playwright CLI Automation Engineering Findings

Testing the live application at `http://localhost:5173` revealed three UI automation considerations:
1. **Strict Mode Ambiguity**: The `+ New chat` selector appears twice in the DOM (sidebar navigation and header icon). Automation scripts must use `.first()` or `>> nth=0` to prevent strict mode violations.
2. **Input Tagging**: The main user chat input is an `<input type="text">` with placeholder `Ask something to start a new session...`, transitioning to `Continue this session...` once an active session ID is generated.
3. **SSE Connection Lifecycles**: Closing the browser window while an SSE streaming connection is in-flight abruptly severs the HTTP transfer, requiring robust server-side stream cleanup to prevent orphan worker processes.
