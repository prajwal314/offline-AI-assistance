# RAG Evaluation

## Threshold experiment (how to choose threshold)
Chroma uses cosine distance 0=identical 2=opposite (1 - cosine similarity).
1. Run dataset with no threshold, log distances of retrieved chunks.
2. For answerable Qs, note distances of correct chunks (typically 0.6-1.0).
3. For unanswerable Qs (e.g. "population of Mars"), note best distance (typically >1.2).
4. Pick threshold between them, e.g. 1.1-1.3. Validate via `runEvaluation.js`.

```
node evaluation/runEvaluation.js 5        # no threshold
node evaluation/runEvaluation.js 5 1.2    # threshold 1.2
```

Compare retrieval accuracy vs hallucination rate.

## Metrics
- Retrieval accuracy = correct source in Top-K / total
- Top-3 / Top-5 accuracy = same with K=3/5
- Hallucination rate = unanswerable but answered anyway

## Chunk & Top-K experiments
```
# Chunk size: set in src/services/chunkingService.js DEFAULT_CHUNK_SIZE/OVERLAP, re-upload PDFs, then:
node evaluation/runEvaluation.js 3
node evaluation/runEvaluation.js 5
node evaluation/runEvaluation.js 8
# Compare retrieval accuracy, answer quality, latency, irrelevant context
```

## Hallucination test
Unanswerable Qs (#12-15) expected: "I could not find enough relevant information..."

## Dataset
dataset.json: 18 Qs — 8 answerable (document), 5 web, 5 unanswerable/hallucination test.
