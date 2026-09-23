/**
 * Upload pipeline for scanned answer sheets.
 *
 * Three guards, in the order they must run:
 *
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
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";

import {
  ANSWER_SHEET_EXTENSIONS,
  ANSWER_SHEET_LIMITS,
  ANSWER_SHEET_MIME_TYPES,
  answerSheetLimitSummary,
  formatBytes,
} from "../config/uploadLimits";
import { removeTempFile } from "../utils/answerSheetStorage";
import logger from "../config/logger";

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
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase();
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `sheet-${unique}${ext}`);
  },
});

const fileFilter: multer.Options["fileFilter"] = (_req, file, cb) => {
  const ext = path.extname(file.originalname || "").toLowerCase();
  const mimeOk = Boolean(ANSWER_SHEET_MIME_TYPES[file.mimetype]);
  const extOk = ANSWER_SHEET_EXTENSIONS.includes(ext);

  // Browsers mislabel some scanner output as application/octet-stream, so a
  // recognised extension is accepted even when the mime type is unhelpful.
  if (mimeOk || extOk) {
    cb(null, true);
    return;
  }

  cb(
    new multer.MulterError(
      "LIMIT_UNEXPECTED_FILE",
      `${file.originalname}: only PDF, JPG, PNG, WEBP, TIFF and HEIC files are accepted`,
    ),
  );
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

/** Rejects a batch whose declared body size exceeds the per-request cap. */
export const requestSizeGuard = (req: Request, res: Response, next: NextFunction) => {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > ANSWER_SHEET_LIMITS.maxRequestBytes) {
    return res.status(httpStatus.REQUEST_ENTITY_TOO_LARGE).json({
      error: true,
      statusCode: httpStatus.REQUEST_ENTITY_TOO_LARGE,
      message:
        `This batch is ${formatBytes(declared)}, which is over the ` +
        `${formatBytes(ANSWER_SHEET_LIMITS.maxRequestBytes)} limit for one upload. ` +
        `${answerSheetLimitSummary()} Please upload in smaller batches.`,
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

  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? `One of the files is larger than ${formatBytes(ANSWER_SHEET_LIMITS.maxFileBytes)}. ` +
          "Re-scan it at a lower resolution or split it, then try again."
        : err.code === "LIMIT_FILE_COUNT"
          ? `Too many files in one batch. ${answerSheetLimitSummary()}`
          : err.code === "LIMIT_UNEXPECTED_FILE"
            ? err.field || "This file type is not accepted."
            : `Upload rejected: ${err.message}`;

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
  requestSizeGuard,
  uploader.array("sheets", ANSWER_SHEET_LIMITS.maxFilesPerRequest),
  translateUploadError,
];

/** Exactly one sheet, used by replace and by the approval-workflow upload. */
export const answerSheetSingleUpload = (fieldName: string) => [
  requestSizeGuard,
  uploader.single(fieldName),
  translateUploadError,
];

export const ANSWER_SHEET_TEMP_DIR = TEMP_DIR;
