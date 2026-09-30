/**
 * Moves institute logos/banners that are still on local disk up to Cloudinary.
 *
 *   npm run migrate:institute-logos              # move everything
 *   npm run migrate:institute-logos -- --limit=50
 *   npm run migrate:institute-logos -- --dry-run
 *
 * Safe to stop and re-run: a row is only considered done once its Cloudinary
 * public_id is committed. A row whose local file is already gone (lost to an
 * earlier redeploy) is skipped rather than failed, since there is nothing left
 * to move.
 */

import fs from "fs";
import path from "path";

import { sequelize } from "../config/sequelize";
import Institute from "../modals/Institute.modal";
import logger from "../config/logger";
import { uploadInstituteAsset, InstituteAssetKind } from "../utils/instituteStorage";

const parseFlag = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

/** via-exam-api stores these as e.g. "/uploads/institutes/logos/logo-123.png". */
const isLocalPath = (url: string | null): url is string =>
  !!url && url.startsWith("/uploads/");

const REPO_ROOT = path.join(__dirname, "..", "..");

const run = async () => {
  const dryRun = hasFlag("dry-run");
  const limit = Number(parseFlag("limit") ?? 0) || Infinity;

  await sequelize.authenticate();

  const candidates = await Institute.findAll({
    where: { isDeleted: false },
  });

  const pending = candidates.filter(
    (inst) =>
      (isLocalPath(inst.logoUrl) && !inst.logoPublicId) ||
      (isLocalPath(inst.bannerUrl) && !inst.bannerPublicId),
  );

  console.log(`Institutes with a local-disk logo/banner: ${pending.length}`);
  if (dryRun) {
    console.log("Dry run: nothing will be uploaded or changed.");
    await sequelize.close();
    return;
  }
  if (pending.length === 0) {
    console.log("Nothing to migrate.");
    await sequelize.close();
    return;
  }

  let moved = 0;
  let failed = 0;
  let skipped = 0;

  const moveOne = async (institute: Institute, kind: InstituteAssetKind) => {
    const urlField = kind === "logo" ? "logoUrl" : "bannerUrl";
    const publicIdField = kind === "logo" ? "logoPublicId" : "bannerPublicId";
    const url = institute[urlField];

    if (!isLocalPath(url) || institute[publicIdField]) return;

    const localPath = path.join(REPO_ROOT, url.replace(/^\//, ""));
    if (!fs.existsSync(localPath)) {
      console.warn(`  skip  ${institute.instituteId} (${kind}): file not found at ${localPath}`);
      skipped++;
      return;
    }

    try {
      const buffer = await fs.promises.readFile(localPath);
      const stored = await uploadInstituteAsset({
        buffer,
        instituteId: institute.instituteId,
        kind,
      });
      await institute.update({ [urlField]: stored.url, [publicIdField]: stored.publicId });
      moved++;
    } catch (err: any) {
      failed++;
      console.error(`  FAIL  ${institute.instituteId} (${kind}): ${err?.message || err}`);
      logger.error(`[InstituteLogoMigration] ${institute.instituteId} (${kind}) failed: ${err?.message || err}`);
    }
  };

  for (const institute of pending) {
    if (moved + failed >= limit) break;
    await moveOne(institute, "logo");
    if (moved + failed >= limit) break;
    await moveOne(institute, "banner");
  }

  console.log("");
  console.log(`Moved to Cloudinary : ${moved}`);
  console.log(`Failed              : ${failed}`);
  console.log(`Skipped (no file)   : ${skipped}`);

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
