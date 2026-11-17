/**
 * Uploaded files are kept on this server's disk, under uploads/ in the API folder. Nothing new
 * is sent to an outside storage service.
 *
 *   uploads/<area>/…            public, served at /uploads/… (logos, profile photos, paper diagrams)
 *   uploads/private/<area>/…    never served as a plain static file (middlewares/uploadsAccess.ts):
 *     private/answer-sheets/    student scans: only through GET /v1/scanner/getFile/:sheetId,
 *                               which checks access to that sheet
 *     private/model-answers/    model answer files: only to signed-in admins and teachers of the
 *                               institute named in the path (and the super admin)
 *
 * Stored files are named by the server, never by the client. Records keep a file's web path
 * ("/uploads/…"); localPathOf() turns one back into the file on disk.
 *
 * The API and the worker must share this folder (same machine, or the same mounted volume), and
 * it belongs in the server's backups.
 */

import fs from "fs";
import path from "path";
import logger from "../config/logger";

export const UPLOADS_ROOT = path.resolve(process.cwd(), "uploads");
export const PRIVATE_ROOT = path.join(UPLOADS_ROOT, "private");
export const ANSWER_SHEETS_ROOT = path.join(PRIVATE_ROOT, "answer-sheets");
export const MODEL_ANSWERS_ROOT = path.join(PRIVATE_ROOT, "model-answers");

/** `child` is `folder` or inside it (path.relative compares case-insensitively on Windows). */
export const isInside = (child: string, folder: string): boolean => {
  const rel = path.relative(folder, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** An id as a folder or file name part: letters, digits, "_" and "-" only. */
export const safeSegment = (value: unknown, fallback = "unknown"): string =>
  String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "") || fallback;

/** The web path of a file under uploads/: "/uploads/private/model-answers/VI…/x.pdf". */
export const webPathOf = (absolute: string): string =>
  `/uploads/${path.relative(UPLOADS_ROOT, absolute).split(path.sep).join("/")}`;

/**
 * The file behind a stored reference — "/uploads/…", "/v1/uploads/…", "uploads/…" or a full URL
 * to one — or null when it doesn't point inside uploads/.
 */
export const localPathOf = (ref: unknown): string | null => {
  let p = String(ref ?? "").trim();
  if (!p || p.startsWith("data:")) return null;
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      return null;
    }
  }
  p = p.split(/[?#]/)[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    return null;
  }
  const m = p.replace(/\\/g, "/").match(/^\/?(?:v1\/)?uploads\/(.+)$/);
  if (!m || m[1].includes("\0")) return null;
  const absolute = path.resolve(UPLOADS_ROOT, m[1]);
  return absolute !== UPLOADS_ROOT && isInside(absolute, UPLOADS_ROOT) ? absolute : null;
};

/**
 * Writes a file into `folder` (inside uploads/) as `fileName`, from bytes or by copying another
 * file. It is written under a temporary name beside it and then renamed, so nothing ever reads
 * half a file. Returns the stored file's path.
 */
export const writeStoredFile = async (
  folder: string,
  fileName: string,
  data: Buffer | { copyFrom: string },
): Promise<string> => {
  const dir = path.resolve(folder);
  const file = path.join(dir, fileName);
  if (path.dirname(file) !== dir || !isInside(file, UPLOADS_ROOT)) {
    throw new Error("A stored file must stay inside uploads/.");
  }
  await fs.promises.mkdir(dir, { recursive: true });

  const partial = `${file}.${process.pid}-${Date.now()}.part`;
  try {
    if (Buffer.isBuffer(data)) await fs.promises.writeFile(partial, data, { flag: "wx" });
    else await fs.promises.copyFile(data.copyFrom, partial, fs.constants.COPYFILE_EXCL);
    await fs.promises.rename(partial, file);
  } catch (err) {
    await fs.promises.unlink(partial).catch(() => undefined);
    throw err;
  }
  return file;
};

/** Deletes a stored file inside `root` (all of uploads/ by default). Never throws; true when one was removed. */
export const removeStoredFile = async (
  file: string | null | undefined,
  root: string = UPLOADS_ROOT,
  context = "",
): Promise<boolean> => {
  if (!file || !isInside(file, root) || path.resolve(file) === path.resolve(root)) return false;
  try {
    await fs.promises.unlink(file);
    return true;
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      logger.warn(`[Uploads] Could not remove ${webPathOf(file)}${context ? ` (${context})` : ""}: ${err?.message || err}`);
    }
    return false;
  }
};
