// ─── Cleanup of files uploaded for question papers / answer sheets ─────────────
//
// When a question paper or answer sheet is deleted — or an uploaded file is
// replaced — the files it pointed to would otherwise stay behind forever:
//   • question paper diagrams / school logos → local disk, uploads/question-papers/…
//   • answer sheet PDFs and answer diagrams  → Cloudinary, folder "answer-sheets/"
//
// Rules (keep these — deleting files cannot be undone):
//   1. Run only AFTER the database change is committed.
//   2. Only files inside those two locations are ever touched (never institute logos,
//      profile pictures or other Cloudinary assets).
//   3. A file is removed only when NO remaining question paper / answer sheet still
//      refers to it (a copied paper can share a diagram).
//   4. Best effort: a failure is logged and never blocks or undoes the delete.

import fs from "fs";
import path from "path";
import { Op } from "sequelize";
import { sequelize } from "../config/sequelize";
import cloudinary from "../utils/cloudinary";
import logger from "../config/logger";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";

const LOCAL_MARKER = "uploads/question-papers/";
const CLOUD_FOLDER = "answer-sheets/";
const LOCAL_ROOT = path.resolve(process.cwd(), LOCAL_MARKER);

const isCloudinaryAnswerFile = (value: string) =>
  /^https?:\/\/res\.cloudinary\.com\//i.test(value) && value.includes(`/${CLOUD_FOLDER}`);

const isLocalPaperFile = (value: string) => !value.startsWith("data:") && value.includes(LOCAL_MARKER);

/** Every uploaded-file reference found anywhere inside a paper's content / an answer sheet's answers. */
export function collectUploadRefs(value: unknown, found: Set<string> = new Set()): string[] {
  if (typeof value === "string") {
    const v = value.trim();
    if (isCloudinaryAnswerFile(v) || isLocalPaperFile(v)) found.add(v);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectUploadRefs(item, found));
  } else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectUploadRefs(item, found));
  }
  return [...found];
}

/** The stable part of a reference, used to search for other rows that still use the file. */
function searchToken(ref: string): string {
  if (isCloudinaryAnswerFile(ref)) {
    // ".../upload/v1712345/answer-sheets/answerSheetPdf-123.pdf" → "answer-sheets/answerSheetPdf-123"
    const tail = ref.slice(ref.indexOf(`/${CLOUD_FOLDER}`) + 1).split("?")[0];
    return tail.replace(/\.[a-z0-9]+$/i, "");
  }
  return ref.slice(ref.indexOf(LOCAL_MARKER)).split("?")[0];
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

async function isStillReferenced(ref: string): Promise<boolean> {
  const pattern = `%${escapeLike(searchToken(ref))}%`;
  const [papers, answers] = await Promise.all([
    QuestionPaper.count({
      where: sequelize.where(sequelize.cast(sequelize.col("content"), "text"), { [Op.like]: pattern }),
    }),
    QuestionPaperAnswer.count({
      where: sequelize.where(sequelize.cast(sequelize.col("answers"), "text"), { [Op.like]: pattern }),
    }),
  ]);
  return papers + answers > 0;
}

async function removeCloudinaryFile(url: string) {
  // https://res.cloudinary.com/<cloud>/<resource_type>/upload/[v123/]answer-sheets/<name>.<ext>
  const match = url.split("?")[0].match(/\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/i);
  if (!match) return;
  const resourceType = match[1].toLowerCase();
  // "raw" files keep their extension in the public id; images/videos do not.
  const publicId = resourceType === "raw" ? match[2] : match[2].replace(/\.[a-z0-9]+$/i, "");
  if (!publicId.startsWith(CLOUD_FOLDER)) return;
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true });
}

async function removeLocalFile(ref: string) {
  const relative = ref.slice(ref.indexOf(LOCAL_MARKER)).split("?")[0];
  const filePath = path.resolve(process.cwd(), relative);
  // Never follow "../" out of uploads/question-papers/.
  if (!filePath.startsWith(LOCAL_ROOT + path.sep)) return;
  await fs.promises.unlink(filePath).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== "ENOENT") throw err;
  });
}

/** Removes the given uploaded files that nothing refers to any more. */
export async function removeUnusedUploads(refs: string[], context: string): Promise<number> {
  let removed = 0;
  for (const ref of new Set(refs)) {
    try {
      if (await isStillReferenced(ref)) continue;
      if (isCloudinaryAnswerFile(ref)) await removeCloudinaryFile(ref);
      else if (isLocalPaperFile(ref)) await removeLocalFile(ref);
      else continue;
      removed++;
    } catch (err: any) {
      logger.warn(`[Uploads] Could not remove ${ref} (${context}): ${err?.message || err}`);
    }
  }
  if (removed) logger.info(`[Uploads] Removed ${removed} unused file(s) after ${context}.`);
  return removed;
}

/** Fire-and-forget version for request handlers (the response does not wait for it). */
export function cleanupUploadsInBackground(refs: string[], context: string): void {
  if (!refs.length) return;
  removeUnusedUploads(refs, context).catch((err) =>
    logger.warn(`[Uploads] Cleanup after ${context} failed: ${err?.message || err}`)
  );
}
