/**
 * Answer-sheet upload limits.
 *
 * These are the single source of truth for how much data one request may
 * carry. multer enforces the per-file size, a guard middleware enforces the
 * whole-request size before a single byte is parsed, and the same numbers are
 * mirrored in the scanner UI so the browser can split a large selection into
 * batches instead of firing one enormous request.
 *
 * Why these values:
 *   • 20 MB per file  — a colour-scanned multi-page answer booklet at 200 DPI
 *     lands well under this; anything larger is a scanner misconfiguration.
 *   • 10 files per request — keeps one request short enough to finish inside a
 *     normal proxy timeout, and makes a failure cheap to retry.
 *   • 60 MB per request — the real protection. Without it, "10 files" still
 *     allows 200 MB, and a handful of concurrent scanners would exhaust the
 *     host. Files are buffered to disk rather than memory, so this caps disk
 *     churn rather than RAM.
 *
 * A scanning station uploading 300 sheets sends 30 sequential requests and
 * sees per-batch progress, instead of one request that dies at minute four and
 * loses everything.
 */

export const ANSWER_SHEET_LIMITS = {
  /** Largest single answer sheet accepted. */
  maxFileBytes: 20 * 1024 * 1024,
  /** Largest number of sheets in one request. */
  maxFilesPerRequest: 10,
  /** Largest total body size for one upload request, headers excluded. */
  maxRequestBytes: 60 * 1024 * 1024,
} as const;

/** Formats used by scanning hardware. Anything else is rejected by name. */
export const ANSWER_SHEET_MIME_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/tiff": ".tif",
  "image/heic": ".heic",
};

export const ANSWER_SHEET_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".tif",
  ".tiff",
  ".heic",
];

export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 MB";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

/** Human summary used in error messages and on the upload screen. */
export const answerSheetLimitSummary = (): string =>
  `Up to ${ANSWER_SHEET_LIMITS.maxFilesPerRequest} files per batch, ` +
  `${formatBytes(ANSWER_SHEET_LIMITS.maxFileBytes)} per file, ` +
  `${formatBytes(ANSWER_SHEET_LIMITS.maxRequestBytes)} per batch.`;
