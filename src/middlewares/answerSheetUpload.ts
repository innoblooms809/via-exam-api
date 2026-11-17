/**
 * Upload pipeline for scanned answer sheets.
 *
 * Four guards, in the order they must run:
 *
 *   0. uploadConcurrencyGuard — too many uploads in progress (this user, or in
 *      all): 429 with Retry-After, before anything is read; the UI retries.
 *   1. requestSizeGuard  — rejects an oversized body from its Content-Length
 *      header, before multer reads a single byte. Without this the server
 *      still has to consume the whole upload just to discover it is too big.
 *   2. multer (disk)     — buffers each file to a temp directory rather than
 *      memory, so a batch of 20 MB scans never lands on the heap.
 *   3. translateUploadError — turns multer's terse codes into something a
 *      scanner operator can act on.
 *
 * Every downstream handler must call releaseTempFiles(req) when it is done,
 * whether it succeeded or not, or the temp directory grows without bound.
 */

import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";

import { ANSWER_SHEET_CONCURRENCY, ANSWER_SHEET_LIMITS, answerSheetLimitSummary } from "../config/uploadLimits";
import { removeTempFile } from "../utils/answerSheetStorage";
import logger from "../config/logger";
import { ANSWER_SHEET_DETECTED_TYPES } from "../utils/fileSignature";
import { decodeUploadName } from "../utils/fileNames";
import { bytes, msg } from "../i18n/message";
import { verifyUploads } from "./verifyUpload";

const TEMP_DIR = path.join(os.tmpdir(), "viaexam-answer-sheets");

const ensureTempDir = () => {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    try {
      ensureTempDir();
      cb(null, TEMP_DIR);
    } catch (err: any) {
      cb(err, TEMP_DIR);
    }
  },
  // Temp names never carry the client's file name or extension.
  filename: (_req, _file, cb) => {
    cb(null, `sheet-${randomUUID()}.upload`);
  },
});

/** A file that isn't a PDF by its name or declared type (multer's own errors keep their codes). */
class NotPdfError extends Error {
  constructor(readonly fileName: string) {
    super(`${fileName}: only PDF files are accepted`);
  }
}

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  // The name in the script it was written in ("١٠١.pdf"), not as busboy read it; the roll
  // number is taken from it. Everything after this sees the fixed name.
  file.originalname = decodeUploadName(file.originalname);
  const ext = path.extname(file.originalname || "").toLowerCase();
  // Answer sheets are PDFs only. Browsers mislabel some scanner output as
  // application/octet-stream, so a .pdf name with an unhelpful type passes here;
  // the file's bytes are checked after upload (ANSWER_SHEET_DETECTED_TYPES).
  const mimeOk = file.mimetype === "application/pdf" || file.mimetype === "application/octet-stream" || !file.mimetype;
  if (ext === ".pdf" && mimeOk) {
    cb(null, true);
    return;
  }

  cb(new NotPdfError(file.originalname));
};

const uploader = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: ANSWER_SHEET_LIMITS.maxFileBytes,
    files: ANSWER_SHEET_LIMITS.maxFilesPerRequest,
    // Text fields on this route are short ids; a large one signals abuse.
    fieldSize: 64 * 1024,
    fields: 32,
  },
});

// Upload requests in progress, per user and in all (this process).
const inFlightByUser = new Map<string, number>();
let inFlightTotal = 0;

/**
 * Load shedding: past the per-user or total number of uploads in progress, answers 429 with
 * a Retry-After (also in the body, which a cross-origin page can read) before any byte of
 * the file is read. The scanner UI sends that sheet again after the wait.
 */
export const uploadConcurrencyGuard = (req: Request, res: Response, next: NextFunction) => {
  const user = String((req as any).viaExamUser?.userId ?? req.ip ?? "anonymous");
  const mine = inFlightByUser.get(user) ?? 0;
  if (mine >= ANSWER_SHEET_CONCURRENCY.perUser || inFlightTotal >= ANSWER_SHEET_CONCURRENCY.total) {
    const retryAfterSec = ANSWER_SHEET_CONCURRENCY.retryAfterSec;
    res.setHeader("Retry-After", String(retryAfterSec));
    return res.status(httpStatus.TOO_MANY_REQUESTS).json({
      error: true,
      statusCode: httpStatus.TOO_MANY_REQUESTS,
      message:
        mine >= ANSWER_SHEET_CONCURRENCY.perUser
          ? msg("Too many sheets are uploading from this account at once. This one will be sent again in a moment.")
          : msg("The server is busy with other uploads. This sheet will be sent again in a moment."),
      data: { retryAfterSec },
    });
  }

  inFlightByUser.set(user, mine + 1);
  inFlightTotal += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlightTotal = Math.max(0, inFlightTotal - 1);
    const left = (inFlightByUser.get(user) ?? 1) - 1;
    if (left > 0) inFlightByUser.set(user, left);
    else inFlightByUser.delete(user);
  };
  // Answered, or the browser went away (a cancelled upload): either frees the slot.
  res.once("finish", release);
  res.once("close", release);
  return next();
};

/** Uploads in progress now (for tests and the health page). */
export const uploadsInFlight = () => ({ total: inFlightTotal, users: inFlightByUser.size });

/** Rejects a batch whose declared body size exceeds the per-request cap. */
export const requestSizeGuard = (req: Request, res: Response, next: NextFunction) => {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > ANSWER_SHEET_LIMITS.maxRequestBytes) {
    return res.status(httpStatus.REQUEST_ENTITY_TOO_LARGE).json({
      error: true,
      statusCode: httpStatus.REQUEST_ENTITY_TOO_LARGE,
      message: msg("This batch is {{size}}, which is over the {{limit}} limit for one upload. {{limits}} Please upload in smaller batches.", {
        size: bytes(declared),
        limit: bytes(ANSWER_SHEET_LIMITS.maxRequestBytes),
        limits: answerSheetLimitSummary(),
      }),
      data: { limits: ANSWER_SHEET_LIMITS },
    });
  }
  return next();
};

/** Turns multer errors into operator-readable messages. */
export const translateUploadError = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!err) return next();

  // Whatever multer managed to write before failing must not be left behind.
  void releaseTempFiles(req);

  if (err instanceof NotPdfError) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: msg("{{name}}: only PDF files are accepted.", { name: err.fileName }),
      data: { limits: ANSWER_SHEET_LIMITS },
    });
  }

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? msg("One of the files is larger than {{limit}}. Re-scan it at a lower resolution or split it, then try again.", {
            limit: bytes(ANSWER_SHEET_LIMITS.maxFileBytes),
          })
        : err.code === "LIMIT_FILE_COUNT"
          ? msg("Too many files in one batch. {{limits}}", { limits: answerSheetLimitSummary() })
          : err.code === "LIMIT_UNEXPECTED_FILE"
            ? msg("Unexpected file field \"{{field}}\".", { field: String(err.field ?? "").slice(0, 40) })
            : msg("Upload rejected: {{reason}}", { reason: err.message });

    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message,
      data: { limits: ANSWER_SHEET_LIMITS },
    });
  }

  logger.error(`[AnswerSheets] Upload middleware failed: ${err?.message || err}`);
  return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
    error: true,
    statusCode: httpStatus.INTERNAL_SERVER_ERROR,
    message: "Upload failed before the files could be read. Please try again.",
  });
};

/** Deletes every temp file multer created for this request. Never throws. */
export const releaseTempFiles = async (req: Request): Promise<void> => {
  const files: Express.Multer.File[] = [];
  if (Array.isArray(req.files)) files.push(...(req.files as Express.Multer.File[]));
  else if (req.files && typeof req.files === "object") {
    for (const group of Object.values(req.files as Record<string, Express.Multer.File[]>)) {
      if (Array.isArray(group)) files.push(...group);
    }
  }
  if (req.file) files.push(req.file);

  await Promise.all(files.map((f) => removeTempFile(f?.path)));
};

/** Many sheets in one batch, multipart field name "sheets". */
export const answerSheetBatchUpload = [
  uploadConcurrencyGuard,
  requestSizeGuard,
  uploader.array("sheets", ANSWER_SHEET_LIMITS.maxFilesPerRequest),
  translateUploadError,
];

/** Exactly one sheet, used by replace and by the approval-workflow upload. */
export const answerSheetSingleUpload = (fieldName: string) => [
  uploadConcurrencyGuard,
  requestSizeGuard,
  uploader.single(fieldName),
  translateUploadError,
  // Batches check each file in the service (one bad file must not sink the
  // batch); a single upload is simply refused here.
  verifyUploads(ANSWER_SHEET_DETECTED_TYPES),
];

export const ANSWER_SHEET_TEMP_DIR = TEMP_DIR;
