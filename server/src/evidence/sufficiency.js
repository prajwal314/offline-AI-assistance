/**
 * Sufficiency verdict (Change 4, step 5).
 * Pure decision function; the retry loop lives in assembler.js.
 *
 * Verdicts:
 *  - 'answer'   full coverage, no conflicts.
 *  - 'qualified' full coverage but conflicting chunks: answer, but surface
 *    the conflict next to the answer (preferred = active/latest).
 *  - 'abstain'  coverage still incomplete after bounded retries: do not
 *    answer from partial evidence; abstain with a clear message.
 */

const MIN_COVERAGE = 1.0;

function decideVerdict({ coverageRatio, uncovered, conflicts, retriesExhausted, minCoverage = MIN_COVERAGE }) {
  const ratio = typeof coverageRatio === "number" ? coverageRatio : 0;
  const hasConflict = Array.isArray(conflicts) && conflicts.length > 0;
  if (ratio >= minCoverage && !(uncovered && uncovered.length > 0)) {
    return hasConflict ? "qualified" : "answer";
  }
  if (retriesExhausted) return "abstain";
  return "retry";
}

module.exports = { decideVerdict, MIN_COVERAGE };
