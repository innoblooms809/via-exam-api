/**
 * Checks the scan quality of answer sheets uploaded before the check existed.
 *
 *   npm run sheets:check-quality                    # every unchecked PDF sheet
 *   npm run sheets:check-quality -- --exam=EX123    # one exam's sheets
 *   npm run sheets:check-quality -- --limit=50
 *   npm run sheets:check-quality -- --all           # check again, already checked ones too
 *   npm run sheets:check-quality -- --dry-run
 *
 * Downloads each sheet from Cloudinary, measures it and saves the flag. Safe to
 * stop and re-run: a sheet is done once its flag is saved. A sheet the API opens
 * for evaluation is also checked on the spot if it has no flag yet.
 */

import { Op } from "sequelize";
import { sequelize } from "../config/sequelize";
import Scanner from "../models/Scanner.model";
import { checkStoredSheet } from "../services/answer-sheet/sheetQuality.service";

const parseFlag = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : null;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const run = async () => {
  const limit = Number(parseFlag("limit") ?? 0) || undefined;
  const examId = parseFlag("exam");

  await sequelize.authenticate();

  const where: any = {
    isDeleted: false,
    fileMimeType: "application/pdf",
    ...(hasFlag("all") ? {} : { qualityFlag: { [Op.is]: null } }),
    ...(examId ? { examId } : {}),
  };
  const sheets = await Scanner.findAll({ where, attributes: ["sheetId", "rollNo"], order: [["createdAt", "ASC"]], limit });

  console.log(`Sheets to check: ${sheets.length}`);
  if (hasFlag("dry-run")) {
    console.log("Dry run: nothing will be checked or changed.");
    await sequelize.close();
    return;
  }

  const tally: Record<string, number> = { ok: 0, warn: 0, low: 0, unchecked: 0, skipped: 0 };
  for (const [i, s] of sheets.entries()) {
    const report = await checkStoredSheet(s.sheetId);
    const key = report?.flag ?? "skipped";
    tally[key] = (tally[key] ?? 0) + 1;
    console.log(`[${i + 1}/${sheets.length}] ${s.sheetId} roll ${s.rollNo}: ${key}${report?.reasons.length ? ` (${report.reasons.join("; ")})` : ""}`);
  }

  console.log("");
  console.log(`Good scans        : ${tally.ok}`);
  console.log(`Check AI marks    : ${tally.warn}`);
  console.log(`Low quality       : ${tally.low}`);
  console.log(`Could not measure : ${tally.unchecked}`);
  console.log(`Skipped           : ${tally.skipped}`);

  await sequelize.close();
};

run().catch(async (err) => {
  console.error("Quality check aborted:", err?.message || err);
  try {
    await sequelize.close();
  } catch {
    /* already closed */
  }
  process.exit(1);
});
