/**
 * Feature extractor (Change 3).
 * extractFeatures(query, candidate, opts) -> normalized 0-1 feature values:
 *   semantic  normalized Chroma similarity (denseScore, or mapped distance)
 *   keyword   normalized BM25 (bm25Score/sparseScore, or saturated raw score)
 *   metadata  rule-based match with requested docType/department/entity
 *   temporal  validity for the requested date/version (status + effective-date
 *             rules; date/version mentions detected in the query)
 *
 * Missing signals degrade to documented neutrals, never NaN. Anything outside
 * [0, 1] is clamped.
 */

const { hasIdOrCode, parseQueryDates, parseQueryVersions } = require("./weights");

function clamp01(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function round4(n) {
  return parseFloat(Number(n).toFixed(4));
}

function pickMeta(meta, keys) {
  for (const k of keys) {
    const v = meta?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Query signal parsing
// ---------------------------------------------------------------------------

function compareVersionParts(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function parseVersionParts(v) {
  const m = String(v || "").match(/(\d+(?:\.\d+){0,2})/);
  return m ? m[1].split(".").map(Number) : null;
}

function toIsoDay(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, "0")}-${String(dmy[1]).padStart(2, "0")}`;
  const y = s.match(/\b((?:19|20)\d{2})\b/);
  if (y) return `${y[1]}-01-01`;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** Lightweight signals shared by weight resolution and feature extraction. */
function detectSignals(query, opts = {}) {
  const queryDates = parseQueryDates(query);
  const queryVersions = parseQueryVersions(query);
  const facets = {
    docType: opts.docType ?? null,
    department: opts.department ?? null,
    entity: opts.entity ?? null,
  };
  return {
    hasIdOrCode: hasIdOrCode(query),
    queryDates,
    queryVersions,
    hasDateOrVersion:
      queryDates.length > 0 || queryVersions.length > 0 || opts.asOfDate != null || opts.version != null,
    hasMetadataRequest: Object.values(facets).some((v) => v !== null && String(v).trim() !== ""),
    facets,
  };
}

// ---------------------------------------------------------------------------
// Per-feature extractors (each returns { value, detail })
// ---------------------------------------------------------------------------

function extractSemantic(candidate) {
  const c = candidate || {};
  if (typeof c.denseScore === "number") return { value: round4(clamp01(c.denseScore, 0.5)), detail: "denseScore" };
  if (typeof c.distance === "number") {
    return { value: round4(clamp01(1 - c.distance / 2, 0.5)), detail: "mapped from distance" };
  }
  return { value: 0.5, detail: "no dense signal (neutral)" };
}

function extractKeyword(candidate) {
  const c = candidate || {};
  const direct = c.bm25Score ?? c.sparseScore;
  if (typeof direct === "number") return { value: round4(clamp01(direct, 0)), detail: "normalized bm25" };
  if (typeof c.rawBm25Score === "number") {
    // Saturating norm for unbounded raw BM25: raw / (1 + raw).
    const v = c.rawBm25Score <= 0 ? 0 : c.rawBm25Score / (1 + c.rawBm25Score);
    return { value: round4(clamp01(v, 0)), detail: "saturated rawBm25Score" };
  }
  return { value: 0, detail: "no keyword signal" };
}

const FACET_KEYS = {
  docType: ["docType", "documentType", "type"],
  department: ["department", "dept"],
  entity: ["entity"],
};

function matchFacet(requested, metaValue, text) {
  const want = String(requested).toLowerCase();
  if (metaValue) {
    const have = metaValue.toLowerCase();
    return have.includes(want) || want.includes(have)
      ? { value: 1, note: "metadata match" }
      : { value: 0, note: "metadata mismatch" };
  }
  if (text && text.toLowerCase().includes(want)) {
    return { value: 0.6, note: "text mention (weak)" };
  }
  return { value: 0.5, note: "unknown (no metadata)" };
}

function extractMetadata(query, candidate, facets) {
  const requested = Object.entries(facets || {}).filter(([, v]) => v !== null && String(v).trim() !== "");
  if (requested.length === 0) return { value: 0.5, detail: "no metadata request (neutral)" };
  const meta = candidate?.metadata || {};
  const text = candidate?.text || "";
  const parts = requested.map(([facet, want]) => {
    const metaValue = pickMeta(meta, FACET_KEYS[facet] || [facet]);
    const r = matchFacet(want, metaValue, text);
    return { facet, want: String(want), ...r };
  });
  const value = parts.reduce((s, p) => s + p.value, 0) / parts.length;
  return { value: round4(value), detail: parts };
}

const STATUS_SCORES = { active: 1, draft: 0.6, superseded: 0.3 };

function extractTemporal(query, candidate, opts, signals) {
  const meta = candidate?.metadata || {};
  const rawStatus = pickMeta(meta, ["status", "docStatus", "documentStatus"]);
  const status = rawStatus ? rawStatus.toLowerCase() : null;
  const effectiveDate = toIsoDay(pickMeta(meta, ["effectiveDate", "effective_date", "effectiveDateISO"]));
  const chunkVersion = pickMeta(meta, ["version", "documentVersion", "docVersion"]);
  const sig = signals || detectSignals(query, opts);
  const requestedDate = toIsoDay(opts.asOfDate) || sig.queryDates[0]?.iso || null;
  const requestedVersion = opts.version != null ? String(opts.version) : sig.queryVersions[0]?.raw || null;

  const hasInfo =
    status !== null || effectiveDate !== null || chunkVersion !== null ||
    requestedDate !== null || requestedVersion !== null;
  if (!hasInfo) return { value: 0.5, detail: { note: "no temporal signals (neutral)" } };

  const parts = [];
  const detail = { status, requestedDate, effectiveDate, requestedVersion, chunkVersion, parts: [] };

  const statusScore = status ? (STATUS_SCORES[status] ?? 0.5) : 0.8;
  parts.push(statusScore);
  detail.parts.push({ rule: "status", score: statusScore });

  if (requestedDate || effectiveDate) {
    let dateScore;
    if (requestedDate && effectiveDate) {
      dateScore = effectiveDate <= requestedDate ? 1 : 0.2;
    } else {
      dateScore = requestedDate && !effectiveDate ? 0.5 : 0.7;
    }
    parts.push(dateScore);
    detail.parts.push({ rule: "effective-date", score: dateScore });
  }

  if (requestedVersion || chunkVersion) {
    let versionScore;
    if (requestedVersion && chunkVersion) {
      const reqParts = parseVersionParts(requestedVersion);
      const chunkParts = parseVersionParts(chunkVersion);
      if (reqParts && chunkParts) {
        const cmp = compareVersionParts(chunkParts, reqParts);
        versionScore = cmp === 0 ? 1 : cmp < 0 ? 0.6 : 0.3;
      } else {
        versionScore = chunkVersion.toLowerCase().includes(String(requestedVersion).toLowerCase()) ||
          String(requestedVersion).toLowerCase().includes(chunkVersion.toLowerCase()) ? 1 : 0.4;
      }
    } else {
      versionScore = requestedVersion && !chunkVersion ? 0.5 : 0.7;
    }
    parts.push(versionScore);
    detail.parts.push({ rule: "version", score: versionScore });
  }

  return { value: round4(parts.reduce((s, v) => s + v, 0) / parts.length), detail };
}

function extractFeatures(query, candidate, opts = {}) {
  const signals = detectSignals(query, opts);
  const semantic = extractSemantic(candidate);
  const keyword = extractKeyword(candidate);
  const metadata = extractMetadata(query, candidate, signals.facets);
  const temporal = extractTemporal(query, candidate, opts, signals);
  return {
    features: {
      semantic: semantic.value,
      keyword: keyword.value,
      metadata: metadata.value,
      temporal: temporal.value,
    },
    details: { semantic: semantic.detail, keyword: keyword.detail, metadata: metadata.detail, temporal: temporal.detail },
    signals,
  };
}

module.exports = {
  clamp01,
  parseQueryDates,
  parseQueryVersions,
  compareVersionParts,
  toIsoDay,
  detectSignals,
  extractSemantic,
  extractKeyword,
  extractMetadata,
  extractTemporal,
  extractFeatures,
};
