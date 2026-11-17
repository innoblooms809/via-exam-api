/**
 * Roll numbers and file names in any script, for rows stored before the API normalized them.
 *
 * A roll number typed on an Arabic, Persian or Indian keyboard was stored in that script's
 * digits ("١٠١"), sometimes with an invisible direction mark, so an answer sheet named
 * "101.pdf" never found its student. New roll numbers are stored with 0-9 (utils/textRules);
 * this rewrites the older ones in enrolments, student profiles and answer sheets the same way.
 * An active enrolment whose roll number, written with 0-9, another student of its section
 * already has in that session is left as it is and listed in the job's detail: two students
 * can't share a roll number, so the admin decides who keeps it (on the student's page).
 *
 * Answer-sheet file names stored while uploads read names as latin1 ("ÙˆØ±Ù‚Ø©.pdf") get
 * back the names they were ("ورقة.pdf").
 *
 * Every start, once per database (a row in viaexam_data_jobs, under an advisory lock like
 * sessionScopeBackfill). A failure is logged and the job runs again at the next start: it never
 * keeps the API from starting. src/scripts/normalizeRollNumbers.ts runs it by hand, and with
 * --dry-run lists what it would change without changing anything.
 */

import { QueryTypes, type Transaction } from "sequelize";
import logger from "../config/logger";
import { sequelize } from "../config/sequelize";
import { normalizeRollNo } from "../utils/textRules";
import { decodeUploadName } from "../utils/fileNames";

export const ROLL_NUMBER_JOB = "roll-number-digits-v1";

/** Rows read at a time. */
const PAGE = 500;
/** Longest roll number an enrolment holds (its column is 32 characters). */
const MAX_ROLL = 32;
/** Skipped rows kept in the job's detail; the count is always complete. */
const MAX_LISTED = 200;

/** Values normalizing could change: anything but plain printable ASCII without spaces around it. */
const notPlain = (column: string) => `("${column}" !~ '^[ -~]*$' OR "${column}" <> btrim("${column}"))`;

export interface RollNumberBackfillDetail {
  dryRun: boolean;
  enrollments: number;
  profiles: number;
  answerSheets: number;
  fileNames: number;
  skippedCount: number;
  skipped: { table: string; id: string; from: string; to: string; reason: string }[];
}

/** Every row of `table` matching `where`, a page at a time, in id order. */
const eachRow = async (
  table: string,
  columns: string[],
  where: string,
  transaction: Transaction,
  visit: (row: any) => Promise<void>
) => {
  let afterId = 0;
  for (;;) {
    const rows = (await sequelize.query(
      `SELECT id, ${columns.map((c) => `"${c}"`).join(", ")} FROM ${table} WHERE id > :afterId AND ${where} ORDER BY id LIMIT ${PAGE}`,
      { replacements: { afterId }, type: QueryTypes.SELECT, transaction }
    )) as any[];
    for (const row of rows) await visit(row);
    if (rows.length < PAGE) return;
    afterId = rows[rows.length - 1].id;
  }
};

const normalize = async (transaction: Transaction, dryRun: boolean): Promise<RollNumberBackfillDetail> => {
  const detail: RollNumberBackfillDetail = { dryRun, enrollments: 0, profiles: 0, answerSheets: 0, fileNames: 0, skippedCount: 0, skipped: [] };
  const skip = (table: string, id: string, from: string, to: string, reason: string) => {
    detail.skippedCount++;
    if (detail.skipped.length < MAX_LISTED) detail.skipped.push({ table, id, from, to, reason });
  };

  /** Sets one column of one row, inside its own savepoint so one bad row can't undo the rest. */
  const update = async (table: string, column: string, id: number, value: string) => {
    if (dryRun) return true;
    try {
      await sequelize.transaction({ transaction }, (savepoint) =>
        sequelize.query(`UPDATE ${table} SET "${column}" = :value, "updatedAt" = now() WHERE id = :id`, {
          replacements: { value, id },
          transaction: savepoint,
        })
      );
      return true;
    } catch (err: any) {
      return err?.message || String(err);
    }
  };

  // Enrolments: a roll number is unique among a section's active students in a session.
  const planned = new Set<string>();
  await eachRow(
    "viaexam_student_enrollments",
    ["enrollmentId", "sessionId", "sectionId", "rollNumber", "isActive"],
    notPlain("rollNumber"),
    transaction,
    async (row) => {
      const from = String(row.rollNumber ?? "");
      const to = normalizeRollNo(from);
      if (to === from) return;
      if (!to || to.length > MAX_ROLL) return skip("enrollments", row.enrollmentId, from, to, "no usable roll number");
      if (row.isActive) {
        const key = `${row.sessionId}|${row.sectionId ?? ""}|${to}`;
        const taken = (await sequelize.query(
          `SELECT 1 FROM viaexam_student_enrollments
           WHERE "sessionId" = :sessionId AND "sectionId" IS NOT DISTINCT FROM :sectionId
             AND "rollNumber" = :to AND "isActive" = true AND id <> :id
           LIMIT 1`,
          { replacements: { sessionId: row.sessionId, sectionId: row.sectionId, to, id: row.id }, type: QueryTypes.SELECT, transaction }
        )) as any[];
        if (taken.length || planned.has(key)) return skip("enrollments", row.enrollmentId, from, to, "another student of the section has this roll number");
        planned.add(key);
      }
      const done = await update("viaexam_student_enrollments", "rollNumber", row.id, to);
      if (done === true) detail.enrollments++;
      else skip("enrollments", row.enrollmentId, from, to, done);
    }
  );

  // Student profiles keep a copy of the current enrolment's roll number.
  await eachRow("viaexam_student_profiles", ["userId", "rollNumber"], notPlain("rollNumber"), transaction, async (row) => {
    const from = String(row.rollNumber ?? "");
    const to = normalizeRollNo(from);
    if (to === from || !to) return;
    const done = await update("viaexam_student_profiles", "rollNumber", row.id, to);
    if (done === true) detail.profiles++;
    else skip("profiles", row.userId, from, to, done);
  });

  // Answer sheets: the roll number they were filed under, and the scan's file name.
  await eachRow("viaexam_answer_sheets", ["sheetId", "rollNo"], notPlain("rollNo"), transaction, async (row) => {
    const from = String(row.rollNo ?? "");
    const to = normalizeRollNo(from);
    if (to === from || !to) return;
    const done = await update("viaexam_answer_sheets", "rollNo", row.id, to);
    if (done === true) detail.answerSheets++;
    else skip("answerSheets", row.sheetId, from, to, done);
  });

  await eachRow("viaexam_answer_sheets", ["sheetId", "fileName"], `"fileName" ~ '[^ -~]'`, transaction, async (row) => {
    const from = String(row.fileName ?? "");
    const to = decodeUploadName(from);
    if (to === from || !to) return;
    const done = await update("viaexam_answer_sheets", "fileName", row.id, to);
    if (done === true) detail.fileNames++;
    else skip("answerSheets.fileName", row.sheetId, from, to, done);
  });

  return detail;
};

/**
 * Runs the job unless it already ran on this database. `dryRun` reports what would change and
 * changes nothing (nor records the job). Returns the detail, or null when it had already run.
 */
export const runRollNumberBackfill = async (options: { dryRun?: boolean } = {}): Promise<RollNumberBackfillDetail | null> => {
  const dryRun = Boolean(options.dryRun);
  try {
    await sequelize.query(
      `CREATE TABLE IF NOT EXISTS viaexam_data_jobs (name VARCHAR(100) PRIMARY KEY, "ranAt" TIMESTAMPTZ NOT NULL DEFAULT now(), detail JSONB)`
    );
    return await sequelize.transaction(async (t) => {
      await sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('viaexam:${ROLL_NUMBER_JOB}'))`, { transaction: t });
      const done = (await sequelize.query(`SELECT 1 FROM viaexam_data_jobs WHERE name = :job`, {
        replacements: { job: ROLL_NUMBER_JOB },
        type: QueryTypes.SELECT,
        transaction: t,
      })) as any[];
      if (done.length && !dryRun) return null;

      logger.info(`[${ROLL_NUMBER_JOB}] ${dryRun ? "Dry run: listing" : "Writing"} roll numbers with 0-9 and fixing file names…`);
      const detail = await normalize(t, dryRun);
      if (!dryRun) {
        await sequelize.query(`INSERT INTO viaexam_data_jobs (name, detail) VALUES (:job, CAST(:detail AS JSONB))`, {
          replacements: { job: ROLL_NUMBER_JOB, detail: JSON.stringify(detail) },
          transaction: t,
        });
      }
      const { skipped, ...counts } = detail;
      logger.info(`[${ROLL_NUMBER_JOB}] Done: ${JSON.stringify(counts)}`);
      if (detail.skippedCount) logger.warn(`[${ROLL_NUMBER_JOB}] Left as they were: ${JSON.stringify(skipped)}`);
      return detail;
    });
  } catch (err: any) {
    // Nothing was changed (one transaction). Rosters still match the old values, as they compare
    // roll numbers normalized on both sides; the job runs again at the next start.
    logger.error(`[${ROLL_NUMBER_JOB}] Failed, will retry at the next start: ${err?.stack || err?.message || err}`);
    if (dryRun) throw err;
    return null;
  }
};
