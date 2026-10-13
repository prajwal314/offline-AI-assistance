# Version 1 Offline RAG Evaluation

## Executive summary

This is a frozen **incomplete** evaluation snapshot. The isolated Version 1 stack ingested NIST.AI.100-1.pdf into 34 Chroma chunks. The benchmark harness used the actual HTTP chat route, Top-K 5, document-only retrieval, and no threshold. It timed out at 120 seconds for most requests, so no correctness, abstention, retrieval-recall, citation-accuracy, or latency aggregate is reported as a measured score.

## Actual architecture

PDF extraction: `pdf-parse`; chunking: sentence-oriented 600-word chunks with 100-word overlap; embeddings: Ollama `qwen3-embedding:0.6b`; vector database: Chroma cosine distance; LLM: Ollama `qwen3:4b`; generation: temperature 0.4 and `num_predict` 1000. No retrieval similarity threshold is active.

## Results

Completed persisted responses: 19/30. Technical failures/timeouts: 11/30. The API returns source metadata but ingestion does not preserve PDF page metadata, so answer-level page citations are unavailable.

## Limitations and Version 2 recommendations

This is not a completed baseline. Address generation timeouts, preserve page-level metadata during extraction/chunking, implement evidence-aware abstention before LLM generation, and emit claim-linked citations. Re-run the frozen dataset after those changes only as Version 2, retaining this snapshot unchanged.
