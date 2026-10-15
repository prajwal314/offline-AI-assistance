/**
 * Conflict detection (Change 4, step 4).
 * Flags chunks from different versions/dates/statuses that make incompatible
 * claims about the same thing. Conflicts are SURFACED (preferred = active /
 * latest first), never hidden: all conflicting chunks stay in the selection,
 * ordered with the preferred chunk first.
 */

const { computeJaccardSimilarity } = require("./diversityFilter");
const { compareVersionParts } = require("../scoring/features");

const SIMILARITY_FLOOR = 0.2;
const STATUS_RANK = { active: 0, draft: 1, superseded: 2 };

function pickMeta(meta, keys) {
  for (const k of keys) {
    const v = meta?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

function chunkVersionInfo(c) {
  const meta = c?.metadata || {};
  const statusRaw = pickMeta(meta, ["status", "docStatus", "documentStatus"]);
  const version = pickMeta(meta, ["version", "documentVersion", "docVersion"]);
  const effectiveDate = pickMeta(meta, ["effectiveDate", "effective_date"]);
  return { status: statusRaw ? statusRaw.toLowerCase() : null, version, effectiveDate };
}

function docKeyOf(c, i) {
  const meta = c?.metadata || {};
  return String(meta.documentId ?? meta.filename ?? c?.chunkId ?? c?.id ?? `c${i}`);
}

function parseParts(v) {
  const m = String(v || "").match(/(\d+(?:\.\d+){0,2})/);
  return m ? m[1].split(".").map(Number) : null;
}

function rankChunk(c) {
  const { status, version, effectiveDate } = chunkVersionInfo(c);
  return {
    statusRank: status ? (STATUS_RANK[status] ?? 1.5) : 1.5,
    effectiveDate: effectiveDate || "",
    versionParts: parseParts(version) || [0],
  };
}

/** Preferred chunk: active status first, then latest date, then highest version. */
function pickPreferred(chunks) {
  return [...chunks].sort((a, b) => {
    const ra = rankChunk(a);
    const rb = rankChunk(b);
    if (ra.statusRank !== rb.statusRank) return ra.statusRank - rb.statusRank;
    if (ra.effectiveDate !== rb.effectiveDate) return rb.effectiveDate.localeCompare(ra.effectiveDate);
    return compareVersionParts(rb.versionParts, ra.versionParts);
  })[0];
}

function versionTupleDiffer(a, b) {
  const ia = chunkVersionInfo(a);
  const ib = chunkVersionInfo(b);
  return (
    (ia.version || null) !== (ib.version || null) ||
    (ia.effectiveDate || null) !== (ib.effectiveDate || null) ||
    (ia.status || null) !== (ib.status || null)
  );
}

/**
 * detectConflicts(chunks) -> [{ docKey, chunkIds, versions, statuses,
 *   summary, preferredChunkId }]
 */
function detectConflicts(chunks) {
  const list = Array.isArray(chunks) ? chunks : [];
  const groups = new Map();
  list.forEach((c, i) => {
    const key = docKeyOf(c, i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ c, i });
  });

  const conflicts = [];
  for (const [docKey, members] of groups) {
    if (members.length < 2) continue;
    // Find pairs from differing versions/dates/statuses about the same thing.
    const involved = new Set();
    const pairNotes = [];
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        const ca = members[a].c;
        const cb = members[b].c;
        if (!versionTupleDiffer(ca, cb)) continue;
        let sim = 0;
        try {
          sim = computeJaccardSimilarity(ca.text || "", cb.text || "");
        } catch {
          sim = 0;
        }
        if (sim < SIMILARITY_FLOOR) continue;
        involved.add(a);
        involved.add(b);
        const ia = chunkVersionInfo(ca);
        const ib = chunkVersionInfo(cb);
        pairNotes.push(
          `${idOf(ca, members[a].i)} (${label(ia)}) vs ${idOf(cb, members[b].i)} (${label(ib)})`
        );
      }
    }
    if (involved.size === 0) continue;
    const involvedChunks = [...involved].map((idx) => members[idx].c);
    const preferred = pickPreferred(involvedChunks);
    conflicts.push({
      docKey,
      chunkIds: involvedChunks.map((c) => idOf(c, list.indexOf(c))),
      versions: [...new Set(involvedChunks.map((c) => chunkVersionInfo(c).version).filter(Boolean))],
      statuses: [...new Set(involvedChunks.map((c) => chunkVersionInfo(c).status).filter(Boolean))],
      summary: `Conflicting claims in "${docKey}": ${pairNotes.join("; ")}. Preferring active/latest version.`,
      preferredChunkId: idOf(preferred, list.indexOf(preferred)),
    });
  }
  return conflicts;
}

function idOf(c, i) {
  return String(c?.chunkId ?? c?.id ?? `c${i}`);
}

function label(info) {
  return [info.version ? `v${info.version}` : null, info.effectiveDate || null, info.status || null]
    .filter(Boolean)
    .join(" ");
}

module.exports = {
  detectConflicts,
  pickPreferred,
  chunkVersionInfo,
  SIMILARITY_FLOOR,
};
