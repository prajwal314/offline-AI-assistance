# Error analysis

## Observed failure

The actual Version 1 `/api/chat` pipeline was invoked with the indexed document. Most requests failed to persist a `done` result within the 120-second harness limit. This is recorded as a technical failure, not an incorrect answer.

## Likely causes

- The application requests up to 1,000 generated tokens for every answer.
- It sends up to five large chunks to the local model.
- No request timeout exists in the production generation service.
- Chunks lack PDF page metadata, so citations cannot be page-validated.

## Counts

Persisted responses: 19. Unfinished/timeout attempts: 11. No unsupported-answer, correctness, or retrieval-recall score is inferred from missing outputs.
