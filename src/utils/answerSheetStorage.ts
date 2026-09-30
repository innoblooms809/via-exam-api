/**
 * Cloudinary storage for scanned answer sheets.
 *
 * Answer sheets used to live in Postgres as BLOB("long"). That made every
 * backup carry gigabytes of scans, pushed each file through Node's heap on the
 * way in and out, and gave the database no way to shed the bytes when a sheet
 * was deleted. They now live in Cloudinary and the row keeps only a URL.
 *
 * Files are held as Cloudinary "raw"/"image" assets under a per-institute
 * folder, and are uploaded as a stream from the temporary file multer wrote to
 * disk, so a 20 MB scan is never fully resident in memory.
 */

import fs from "fs";
import path from "path";
import cloudinary from "./cloudinary";
import logger from "../config/logger";
import { ANSWER_SHEET_MIME_TYPES } from "../config/uploadLimits";

/** Root folder. Nothing outside this prefix is ever destroyed by this module. */
export const ANSWER_SHEET_FOLDER = "answer-sheets";

export interface StoredAnswerSheet {
  url: string;
  publicId: string;
  resourceType: "image" | "raw" | "video";
  bytes: number;
  format: string | null;
}

/** Cloudinary treats PDFs as images unless told otherwise; keep them as raw so
 *  pagination and delivery transforms never rewrite a student's paper. */
const resourceTypeFor = (mimeType: string): "image" | "raw" =>
  mimeType === "application/pdf" ? "raw" : "image";

const extensionFor = (mimeType: string, originalName: string): string => {
  const known = ANSWER_SHEET_MIME_TYPES[mimeType];
  if (known) return known;
  const fromName = path.extname(originalName || "").toLowerCase();
  return fromName || "";
};

/** Folder is scoped per institute so one school's scans can never collide with
 *  another's, and so a whole institute can be purged in one call if needed. */
const folderFor = (instituteId: string): string =>
  `${ANSWER_SHEET_FOLDER}/${String(instituteId || "unknown").replace(/[^A-Za-z0-9_-]/g, "")}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Upload one answer sheet. `filePath` is the temporary file multer wrote; the
 * caller is responsible for removing it (see removeTempFile).
 *
 * Retries twice on transient failures. A scanning station on a school network
 * drops connections often enough that a single blip should not cost the
 * operator a re-scan.
 */
export const uploadAnswerSheet = async (params: {
  filePath: string;
  originalName: string;
  mimeType: string;
  instituteId: string;
  sheetId: string;
}): Promise<StoredAnswerSheet> => {
  const { filePath, originalName, mimeType, instituteId, sheetId } = params;
  const resourceType = resourceTypeFor(mimeType);
  const ext = extensionFor(mimeType, originalName);

  // A "raw" public id keeps its extension; an image's must not have one.
  const publicId =
    resourceType === "raw"
      ? `${folderFor(instituteId)}/${sheetId}${ext}`
      : `${folderFor(instituteId)}/${sheetId}`;

  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: resourceType,
            overwrite: true,
            invalidate: true,
            // Scans are records, not media: never let Cloudinary re-encode them.
            unique_filename: false,
            use_filename: false,
          },
          (error: any, uploaded: any) => {
            if (error) reject(error);
            else resolve(uploaded);
          },
        );

        const readStream = fs.createReadStream(filePath);
        readStream.on("error", reject);
        readStream.pipe(stream);
      });

      return {
        url: result?.secure_url ?? "",
        publicId: result?.public_id ?? publicId,
        resourceType: (result?.resource_type ?? resourceType) as StoredAnswerSheet["resourceType"],
        bytes: Number(result?.bytes ?? 0),
        format: result?.format ?? null,
      };
    } catch (err: any) {
      lastError = err;
      const status = err?.http_code ?? err?.statusCode;
      // 4xx means the file itself is unacceptable; retrying cannot help.
      if (status && status >= 400 && status < 500) break;
      if (attempt < 3) await sleep(attempt * 500);
    }
  }

  throw new Error(
    lastError?.message
      ? `Storage upload failed: ${lastError.message}`
      : "Storage upload failed.",
  );
};

/**
 * Remove a stored answer sheet. Best effort by design: the database row is
 * already gone by the time this runs, and a storage hiccup must never surface
 * as a failed delete to the operator.
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

  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: (resourceType as any) || "raw",
      invalidate: true,
    });
    return true;
  } catch (err: any) {
    logger.warn(
      `[AnswerSheets] Could not remove ${publicId} (${context}): ${err?.message || err}`,
    );
    return false;
  }
};

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
 * Cloudinary "raw" assets are private-by-obscurity only. Signed URLs expire, so
 * a link copied out of the scanner dashboard stops working, which is what we
 * want for student papers.
 */
export const signedAnswerSheetUrl = (
  publicId: string,
  resourceType: string,
  ttlSeconds = 300,
): string =>
  cloudinary.url(publicId, {
    resource_type: (resourceType as any) || "raw",
    type: "upload",
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });

/**
 * Returns a scanned sheet's bytes as a Buffer, wherever they live.
 *
 * Every OCR / AI-evaluation pipeline in this codebase reads `sheet.fileBuffer`
 * directly. Since sheets uploaded after the Cloudinary migration keep that
 * column null, each pipeline must resolve the real bytes through this
 * function before touching `sheet.fileBuffer` — see the call sites in
 * aiEvaluation.service.ts, aiEvaluationNew.service.ts, ocrnew5.service.ts and
 * pipeline6.service.ts, each of which assigns the result back onto the
 * in-memory sheet object (never persisted — Sequelize's `.update()` only
 * writes the fields explicitly passed to it) so the rest of that function's
 * logic needs no other change.
 */
export const resolveSheetBuffer = async (sheet: {
  fileBuffer?: Buffer | null;
  fileUrl?: string | null;
  filePublicId?: string | null;
  fileResourceType?: string | null;
}): Promise<Buffer | null> => {
  if (sheet.fileBuffer && sheet.fileBuffer.length > 0) return sheet.fileBuffer;

  const url = sheet.filePublicId
    ? signedAnswerSheetUrl(sheet.filePublicId, sheet.fileResourceType || "raw", 600)
    : sheet.fileUrl;
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not fetch the stored answer sheet (HTTP ${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
