/**
 * Moves answer sheets that are still stored as Postgres blobs up to Cloudinary.
 *
 *   npm run migrate:answer-sheets              # move everything, oldest first
 *   npm run migrate:answer-sheets -- --limit=200
 *   npm run migrate:answer-sheets -- --dry-run
 *
 * Safe to stop and re-run: a row is only considered done once its URL is
 * committed, and the blob is cleared in the same statement. Nothing is dropped
 * on failure, so a row that errors is simply picked up next time.
 *
 * Once this reports 0 remaining, the fileBuffer column can be dropped.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { sequelize } from "../config/sequelize";
import Scanner from "../modals/Scanner.modal";
import logger from "../config/logger";
import { uploadAnswerSheet, removeTempFile } from "../utils/answerSheetStorage";

const BATCH_SIZE = 25;

const parseFlag = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const run = async () => {
  const dryRun = hasFlag("dry-run");
  const limit = Number(parseFlag("limit") ?? 0) || Infinity;

  await sequelize.authenticate();

  const remaining = await Scanner.count({
    where: { fileUrl: null as any, isDeleted: false },
  });

  console.log(`Answer sheets still stored in the database: ${remaining}`);
  if (dryRun) {
    console.log("Dry run: nothing will be uploaded or changed.");
    await sequelize.close();
    return;
  }
  if (remaining === 0) {
    console.log("Nothing to migrate. The fileBuffer column can be dropped.");
    await sequelize.close();
    return;
  }

  const tempDir = path.join(os.tmpdir(), "viaexam-sheet-migration");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  let moved = 0;
  let failed = 0;
  let skipped = 0;

  while (moved + failed + skipped < Math.min(limit, remaining)) {
    const batch = await Scanner.findAll({
      where: { fileUrl: null as any, isDeleted: false },
      order: [["id", "ASC"]],
      limit: BATCH_SIZE,
      offset: failed + skipped, // step over rows this run could not handle
    });

    if (batch.length === 0) break;

    for (const sheet of batch) {
      if (moved + failed + skipped >= limit) break;

      if (!sheet.fileBuffer || sheet.fileBuffer.length === 0) {
        console.warn(`  skip  ${sheet.sheetId} (roll ${sheet.rollNo}): no stored bytes`);
        skipped++;
        continue;
      }

      const tempPath = path.join(tempDir, `${sheet.sheetId}`);
      try {
        // Cloudinary uploads from a stream, so the blob goes to disk first
        // rather than being held in memory twice.
        await fs.promises.writeFile(tempPath, sheet.fileBuffer);

        const stored = await uploadAnswerSheet({
          filePath: tempPath,
          originalName: sheet.fileName,
          mimeType: sheet.fileMimeType,
          instituteId: sheet.instituteId,
          sheetId: sheet.sheetId,
        });

        // URL set and bytes cleared together: the row is never in a state
        // where both are missing.
        await sheet.update({
          fileUrl: stored.url,
          filePublicId: stored.publicId,
          fileResourceType: stored.resourceType,
          fileBuffer: null,
        });

        moved++;
        if (moved % 25 === 0) console.log(`  moved ${moved}…`);
      } catch (err: any) {
        failed++;
        console.error(`  FAIL  ${sheet.sheetId} (roll ${sheet.rollNo}): ${err?.message || err}`);
        logger.error(`[SheetMigration] ${sheet.sheetId} failed: ${err?.message || err}`);
      } finally {
        await removeTempFile(tempPath);
      }
    }
  }

  const left = await Scanner.count({ where: { fileUrl: null as any, isDeleted: false } });

  console.log("");
  console.log(`Moved to Cloudinary : ${moved}`);
  console.log(`Failed              : ${failed}`);
  console.log(`Skipped (no bytes)  : ${skipped}`);
  console.log(`Still in database   : ${left}`);
  if (left === 0) {
    console.log("");
    console.log("All sheets are in Cloudinary. The fileBuffer column can now be dropped.");
  }

  await sequelize.close();
};

run().catch(async (err) => {
  console.error("Migration aborted:", err?.message || err);
  try {
    await sequelize.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
