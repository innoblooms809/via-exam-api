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
 *   • 10 MB per file  — a multi-page answer booklet scanned
 *     at 200 DPI lands well under it. Anything larger is a scanner misconfiguration.
 *   • 10 files per request — keeps one request short enough to finish inside a
 *     normal proxy timeout, and makes a failure cheap to retry.
 *   • 60 MB per request — the real protection. Without it, "10 files" still
 *     allows 200 MB, and a handful of concurrent scanners would exhaust the
 *     host. Files are buffered to disk rather than memory, so this caps disk
 *     churn rather than RAM.
 *
 * A scanning station uploading 100 sheets sends 100 small requests, three at a
 * time, and sees each sheet's progress, instead of one request that dies at
 * minute four and loses everything. (Older screens send batches of up to ten.)
 */

import dotenv from "dotenv";
import path from "path";
import { bytes, msg, type LocalizedMessage } from "../i18n/message";

// Read at load time, whichever module imports this first.
dotenv.config({ path: path.join(process.cwd(), ".env") });

/** A positive whole number from the environment, else the fallback. */
const envInt = (name: string, fallback: number): number => {
  const n = Number.parseInt(String(process.env[name] ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const ANSWER_SHEET_LIMITS = {
  /** Largest single answer sheet accepted. */
  maxFileBytes: 10 * 1024 * 1024,
  /** Largest number of sheets in one request. */
  maxFilesPerRequest: 10,
  /** Largest total body size for one upload request, headers excluded. */
  maxRequestBytes: 60 * 1024 * 1024,
  /**
   * Most sheets one upload in the scanner UI takes (one selection). The browser sends each
   * sheet as its own request, `parallelUploads` at a time, like large-upload sites do: a
   * failure costs one sheet, each sheet shows its own progress, and no request grows big.
   */
  maxFilesPerSelection: envInt("ANSWER_SHEET_MAX_SELECTION", 100),
  /** Sheets one browser uploads at the same time. */
  parallelUploads: envInt("ANSWER_SHEET_PARALLEL_UPLOADS", 3),
} as const;

/**
 * Upload requests the server takes at once: per user (a little above `parallelUploads`, for
 * retries overlapping) and in all. Past either, it answers 429 with a Retry-After, and the
 * browser sends that sheet again after the wait: busy, not failed.
 */
export const ANSWER_SHEET_CONCURRENCY = {
  perUser: envInt("ANSWER_SHEET_MAX_UPLOADS_PER_USER", ANSWER_SHEET_LIMITS.parallelUploads + 2),
  total: envInt("ANSWER_SHEET_MAX_UPLOADS_TOTAL", 30),
  retryAfterSec: 3,
} as const;

/**
 * File extension of each format a stored sheet can be in (names the file in storage). New
 * uploads are PDF only (see answerSheetUpload's filter and ANSWER_SHEET_DETECTED_TYPES);
 * older sheets may be images.
 */
export const ANSWER_SHEET_MIME_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/tiff": ".tif",
  "image/heic": ".heic",
};

/** English bytes for logs ("9.5 MB"); messages take bytes() and are written in the reader's language. */
export const formatBytes = (count: number): string => String(bytes(count));

/** Human summary used in error messages and on the upload screen, in the reader's language. */
export const answerSheetLimitSummary = (): LocalizedMessage =>
  msg("PDF only. Up to {{maxSheets}} sheets per upload, {{maxFile}} per file; up to {{maxFiles}} files and {{maxRequest}} per request.", {
    maxSheets: ANSWER_SHEET_LIMITS.maxFilesPerSelection,
    maxFile: bytes(ANSWER_SHEET_LIMITS.maxFileBytes),
    maxFiles: ANSWER_SHEET_LIMITS.maxFilesPerRequest,
    maxRequest: bytes(ANSWER_SHEET_LIMITS.maxRequestBytes),
  });
