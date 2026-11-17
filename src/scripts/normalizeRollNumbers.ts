/**
 * Rewrites roll numbers stored in Arabic, Persian or Indian digits (١٠١) with 0-9, and reads
 * back answer-sheet file names stored as latin1 (see db/rollNumberBackfill.ts). The API does
 * this by itself once per database when it starts; this runs it by hand.
 *
 *   npm run data:roll-numbers -- --dry-run   # list what would change; nothing is written
 *   npm run data:roll-numbers                # change it (skipped if it already ran)
 */

import "../config/config";
import { sequelize } from "../config/sequelize";
import "../models/index";
import { runRollNumberBackfill } from "../db/rollNumberBackfill";

const run = async () => {
  const dryRun = process.argv.includes("--dry-run");
  await sequelize.authenticate();
  const detail = await runRollNumberBackfill({ dryRun });
  if (!detail) console.log("Already done on this database: nothing to do.");
  else {
    const { skipped, ...counts } = detail;
    console.log(dryRun ? "Would change:" : "Changed:", counts);
    if (skipped.length) {
      console.log("Left as they were (an admin decides):");
      console.table(skipped);
    }
  }
  await sequelize.close();
};

run().catch(async (err) => {
  console.error(err?.stack || err?.message || err);
  await sequelize.close().catch(() => undefined);
  process.exit(1);
});
