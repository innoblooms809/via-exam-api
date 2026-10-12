/**
 * Runs after multer on every upload route. For each received file it:
 *   1. reads the real type from the file's bytes (see utils/fileSignature),
 *   2. refuses anything outside the route's allow-list, whatever its name says,
 *   3. refuses PDFs that carry scripts, launch actions or embedded files,
 *   4. replaces the client's mime type with the detected one, and gives files
 *      stored on disk a server-chosen name with the matching extension, so a
 *      client can never choose what the static server serves.
 *
 * Rejected requests have every received temp file deleted before the response.
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import { findPdfActiveContent, sniffFileType } from "../utils/fileSignature";
import logger from "../config/logger";

const collectFiles = (req: Request): Express.Multer.File[] => {
  const files: Express.Multer.File[] = [];
  if (Array.isArray(req.files)) files.push(...(req.files as Express.Multer.File[]));
  else if (req.files && typeof req.files === "object") {
    for (const group of Object.values(req.files as Record<string, Express.Multer.File[]>)) {
      if (Array.isArray(group)) files.push(...group);
    }
  }
  if (req.file) files.push(req.file);
  return files;
};

const readHead = (filePath: string, bytes = 1024): Buffer => {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const read = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
};

const removeQuietly = (filePath?: string) => {
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => undefined);
};

/** "JPG, PNG or WEBP" */
const acceptedList = (allowed: readonly string[]) => {
  const names = allowed.map((m) => LABELS[m] ?? m);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}` : names[0];
};

const LABELS: Record<string, string> = {
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WEBP",
  "image/tiff": "TIFF",
  "image/heic": "HEIC",
  "application/pdf": "PDF",
};

/**
 * Error middleware for multer: a wrong field, too many files, a file over the
 * size limit or a refused type becomes a 400 with a message, not a 500.
 */
export const translateMulterError = (err: any, req: Request, res: Response, next: NextFunction) => {
  if (!err) return next();
  collectFiles(req).forEach((f) => removeQuietly(f.path));
  const message =
    err?.code === "LIMIT_FILE_SIZE"
      ? "The file is too large."
      : err?.code === "LIMIT_UNEXPECTED_FILE"
        ? `Unexpected file field "${String(err?.field ?? "").slice(0, 40)}".`
        : err?.code === "LIMIT_FILE_COUNT"
          ? "Too many files."
          : String(err?.message ?? "Upload rejected.").slice(0, 200);
  return res.status(httpStatus.BAD_REQUEST).json({ error: true, statusCode: httpStatus.BAD_REQUEST, message });
};

/**
 * Checks one file multer wrote to disk. Used where a batch should reject a
 * single bad file rather than the whole request (answer-sheet batches).
 */
export const inspectDiskFile = (
  filePath: string,
  allowed: readonly string[]
): { ok: true; mime: string } | { ok: false; reason: string } => {
  try {
    const detected = sniffFileType(readHead(filePath));
    if (!detected || !allowed.includes(detected.mime)) {
      const accepted = acceptedList(allowed);
      return { ok: false, reason: `This is not a real ${accepted} file. Only ${accepted} files are accepted.` };
    }
    if (detected.mime === "application/pdf") {
      const problem = findPdfActiveContent(fs.readFileSync(filePath));
      if (problem) return { ok: false, reason: problem };
    }
    return { ok: true, mime: detected.mime };
  } catch {
    return { ok: false, reason: "The file could not be read. Please try again." };
  }
};

/**
 * @param allowed detected mime types this route accepts
 * @param options.renameOnDisk give disk-stored files a random name + real extension
 *                (on for anything under the public uploads folder)
 */
export const verifyUploads =
  (allowed: readonly string[], options: { renameOnDisk?: boolean } = {}) =>
  (req: Request, res: Response, next: NextFunction) => {
    const files = collectFiles(req);
    if (files.length === 0) return next();

    const reject = (message: string) => {
      files.forEach((f) => removeQuietly(f.path));
      return res.status(httpStatus.BAD_REQUEST).json({ error: true, statusCode: httpStatus.BAD_REQUEST, message });
    };

    try {
      for (const file of files) {
        const onDisk = Boolean(file.path);
        const head = onDisk ? readHead(file.path) : (file.buffer ?? Buffer.alloc(0)).subarray(0, 1024);
        const detected = sniffFileType(head);
        const name = String(file.originalname ?? "file").slice(0, 120);

        if (!detected || !allowed.includes(detected.mime)) {
          const accepted = acceptedList(allowed);
          return reject(`${name}: this file is not a real ${accepted} file. Only ${accepted} files are accepted.`);
        }

        if (detected.mime === "application/pdf") {
          const bytes = onDisk ? fs.readFileSync(file.path) : file.buffer;
          const problem = findPdfActiveContent(bytes);
          if (problem) {
            logger.warn(`[Upload] Rejected PDF "${name}" from ${(req as any).viaExamUser?.userId ?? "anonymous"}: ${problem}`);
            return reject(`${name}: ${problem}`);
          }
        }

        file.mimetype = detected.mime;

        if (onDisk && options.renameOnDisk) {
          const safeName = `${file.fieldname.replace(/[^A-Za-z0-9_-]/g, "") || "file"}-${randomUUID()}${detected.ext}`;
          const target = path.join(path.dirname(file.path), safeName);
          fs.renameSync(file.path, target);
          file.path = target;
          file.filename = safeName;
        }
      }
    } catch (err: any) {
      logger.error(`[Upload] Verification failed: ${err?.message || err}`);
      return reject("The uploaded file could not be read. Please try again.");
    }

    return next();
  };
