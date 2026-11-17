/**
 * Storage of scanned answer sheets: on this server's disk, under
 * uploads/private/answer-sheets/<institute>/ (see utils/localFileStorage). They are never served
 * as static files: GET /v1/scanner/getFile/:sheetId streams a sheet after checking access to it.
 *
 * A stored sheet's row keeps where its file is: `fileResourceType` "local", `filePublicId` the
 * file's key under uploads/private/ ("answer-sheets/<institute>/<sheet>.pdf") and `fileUrl` its
 * web path, for the record.
 *
 * Older sheets stay where they were stored: as a database blob, or in Cloudinary ("raw"/"image"
 * rows), read through the public link kept in `fileUrl`. This module no longer talks to
 * Cloudinary: an older sheet's file is left there when its row is deleted.
 */

import fs from "fs";
import path from "path";
import logger from "../config/logger";
import { ANSWER_SHEET_MIME_TYPES } from "../config/uploadLimits";
import {
  ANSWER_SHEETS_ROOT,
  PRIVATE_ROOT,
  isInside,
  removeStoredFile,
  safeSegment,
  webPathOf,
  writeStoredFile,
} from "./localFileStorage";

/** Key prefix of every stored sheet. Nothing outside it is ever deleted by this module. */
export const ANSWER_SHEET_FOLDER = "answer-sheets";

/** `fileResourceType` of a sheet stored on this server's disk. */
export const LOCAL_SHEET = "local";

export interface StoredAnswerSheet {
  url: string;
  publicId: string;
  resourceType: typeof LOCAL_SHEET;
  bytes: number;
  format: string | null;
}

interface SheetLocation {
  filePublicId?: string | null;
  fileResourceType?: string | null;
}

/**
 * Store one answer sheet. `filePath` is the temporary file multer wrote; it is copied, not moved
 * (the scan-quality check may still be reading it), and the caller removes it (removeTempFile).
 */
export const uploadAnswerSheet = async (params: {
  filePath: string;
  originalName: string;
  mimeType: string;
  instituteId: string;
  sheetId: string;
  /**
   * Set when a file replaces another: the new one gets its own name, so no browser cache can
   * show the old scan, and the caller deletes the old file. Only the current scan is kept.
   */
  revision?: string;
}): Promise<StoredAnswerSheet> => {
  const { filePath, mimeType, instituteId, sheetId, revision } = params;
  // The extension of the type found in the file's bytes, never one from the client's name.
  const ext = ANSWER_SHEET_MIME_TYPES[mimeType] ?? "";
  const name = `${safeSegment(revision ? `${sheetId}-${revision}` : sheetId, "sheet")}${ext}`;

  const file = await writeStoredFile(path.join(ANSWER_SHEETS_ROOT, safeSegment(instituteId)), name, {
    copyFrom: filePath,
  });
  const { size } = await fs.promises.stat(file);

  return {
    url: webPathOf(file),
    publicId: path.relative(PRIVATE_ROOT, file).split(path.sep).join("/"),
    resourceType: LOCAL_SHEET,
    bytes: size,
    format: ext ? ext.slice(1) : null,
  };
};

/**
 * The file of a sheet stored on this server, or null (a sheet in Cloudinary or the database).
 * A row read without its resource type names a local sheet only when its file is here.
 */
export const localSheetPath = (sheet: SheetLocation): string | null => {
  const key = sheet.filePublicId;
  if (!key || !key.startsWith(`${ANSWER_SHEET_FOLDER}/`)) return null;
  if (sheet.fileResourceType && sheet.fileResourceType !== LOCAL_SHEET) return null;
  const file = path.resolve(PRIVATE_ROOT, key);
  if (file === ANSWER_SHEETS_ROOT || !isInside(file, ANSWER_SHEETS_ROOT)) return null;
  return sheet.fileResourceType === LOCAL_SHEET || fs.existsSync(file) ? file : null;
};

/**
 * Remove a stored answer sheet. Best effort by design: the database row is already gone by the
 * time this runs, and a storage hiccup must never surface as a failed delete to the operator.
 */
export const destroyAnswerSheet = async (
  publicId: string | null | undefined,
  resourceType: string | null | undefined,
  context: string,
): Promise<boolean> => {
  if (!publicId) return false;

  // Never touch anything outside the answer-sheet tree.
  if (!publicId.startsWith(`${ANSWER_SHEET_FOLDER}/`)) {
    logger.warn(`[AnswerSheets] Refused to destroy out-of-scope asset "${publicId}" (${context}).`);
    return false;
  }

  if (resourceType === LOCAL_SHEET) {
    return removeStoredFile(localSheetPath({ filePublicId: publicId, fileResourceType: resourceType }), ANSWER_SHEETS_ROOT, context);
  }

  // Stored in Cloudinary before the move to local storage: this API no longer deletes there.
  logger.info(`[AnswerSheets] ${publicId} is an older Cloudinary file; left there (${context}).`);
  return false;
};

/** The public link of a sheet stored in Cloudinary before the move to local storage, or null. */
export const remoteSheetUrl = (sheet: SheetLocation & { fileUrl?: string | null }): string | null =>
  !localSheetPath(sheet) && sheet.fileUrl && /^https:\/\//i.test(sheet.fileUrl) ? sheet.fileUrl : null;

/** Deletes a multer temp file. Never throws. */
export const removeTempFile = async (filePath?: string): Promise<void> => {
  if (!filePath) return;
  try {
    await fs.promises.unlink(filePath);
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      logger.warn(`[AnswerSheets] Could not remove temp file ${filePath}: ${err?.message || err}`);
    }
  }
};

/**
 * Returns a scanned sheet's bytes as a Buffer, wherever they live.
 *
 * Every OCR / AI-evaluation pipeline in this codebase reads `sheet.fileBuffer` directly. Sheets
 * stored as files (on disk, or in Cloudinary before that) keep that column null, so each
 * pipeline resolves the real bytes through this function before touching `sheet.fileBuffer` —
 * see the call sites in aiEvaluation.service.ts, aiEvaluationNew.service.ts, ocrnew5.service.ts
 * and pipeline6.service.ts, each of which assigns the result back onto the in-memory sheet
 * object (never persisted — Sequelize's `.update()` only writes the fields explicitly passed to
 * it) so the rest of that function's logic needs no other change.
 */
export const resolveSheetBuffer = async (sheet: {
  fileBuffer?: Buffer | null;
  fileUrl?: string | null;
  filePublicId?: string | null;
  fileResourceType?: string | null;
}): Promise<Buffer | null> => {
  if (sheet.fileBuffer && sheet.fileBuffer.length > 0) return sheet.fileBuffer;

  const local = localSheetPath(sheet);
  if (local) return fs.promises.readFile(local);

  // Stored in Cloudinary before the move to local storage.
  const url = remoteSheetUrl(sheet);
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not fetch the stored answer sheet (HTTP ${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
