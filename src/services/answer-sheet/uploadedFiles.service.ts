// ─── Cleanup of files uploaded for question papers / answer sheets ─────────────
//
// When a question paper or answer sheet is deleted — or an uploaded file is
// replaced — the files it pointed to would otherwise stay behind forever:
//   • question paper diagrams / school logos → uploads/question-papers/…
//   • model answer PDFs and answer diagrams  → uploads/private/model-answers/…
//     (older ones are on Cloudinary and are left there)
//
// Rules (keep these — deleting files cannot be undone):
//   1. Run only AFTER the database change is committed.
//   2. Only files inside those locations are ever touched (never institute logos,
//      profile pictures or student answer sheets).
//   3. A file is removed only when NO remaining question paper / answer sheet still
//      refers to it (a copied paper can share a diagram).
//   4. Best effort: a failure is logged and never blocks or undoes the delete.

import path from "path";
import { Op } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import QuestionPaperAnswer from "../../models/question-paper/StandardAnswer.model";
import { MODEL_ANSWERS_ROOT, UPLOADS_ROOT, localPathOf, removeStoredFile } from "../../utils/localFileStorage";

// Where each kind of local reference lives, by the marker in its address.
const LOCAL_AREAS: { marker: string; root: string }[] = [
  { marker: "uploads/question-papers/", root: path.join(UPLOADS_ROOT, "question-papers") },
  { marker: "uploads/private/model-answers/", root: MODEL_ANSWERS_ROOT },
];

const localAreaOf = (value: string) =>
  value.startsWith("data:") ? undefined : LOCAL_AREAS.find((area) => value.includes(area.marker));

const isLocalPaperFile = (value: string) => Boolean(localAreaOf(value));

/** Every uploaded-file reference found anywhere inside a paper's content / an answer sheet's answers. */
export function collectUploadRefs(value: unknown, found: Set<string> = new Set()): string[] {
  if (typeof value === "string") {
    const v = value.trim();
    if (isLocalPaperFile(v)) found.add(v);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectUploadRefs(item, found));
  } else if (value && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) => collectUploadRefs(item, found));
  }
  return [...found];
}

/** The stable part of a reference, used to search for other rows that still use the file. */
function searchToken(ref: string): string {
  const area = localAreaOf(ref);
  return area ? ref.slice(ref.indexOf(area.marker)).split("?")[0] : ref;
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

async function removeLocalFile(ref: string) {
  const area = localAreaOf(ref);
  if (!area) return;
  // Never follows "../" out of its own folder (removeStoredFile checks the resolved path).
  const relative = ref.slice(ref.indexOf(area.marker)).split("?")[0];
  await removeStoredFile(localPathOf(relative), area.root, "unused upload");
}

/** Removes the given uploaded files that nothing refers to any more. */
export async function removeUnusedUploads(refs: string[], context: string): Promise<number> {
  let removed = 0;
  for (const ref of new Set(refs)) {
    try {
      if (await isStillReferenced(ref)) continue;
      if (!isLocalPaperFile(ref)) continue;
      await removeLocalFile(ref);
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
