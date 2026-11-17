import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import Notification from "../../models/Notification.model";
import { memoize } from "../../utils/memoCache";
import { openSessionIds } from "../academic/sessionSetup.service";

// What "open work" means, in one place: the Staff workload numbers, its page and the
// notifications that leave once the work is done all read the same rows.

/** Exam statuses while its paper is with the setter: not started, being written, sent back. */
export const PAPER_WITH_SETTER = ["Draft", "Paper Created", "Rejected"];

/** Each kind of work, with the notifications that tell its person about it. */
export const WORK_KINDS = {
  papers: { reminder: "PAPER_REMINDER", assigned: "EXAM_ASSIGNED" },
  evaluations: { reminder: "EVALUATION_REMINDER", assigned: "EVALUATION_ASSIGNED" },
  crossChecks: { reminder: "CROSS_CHECK_REMINDER", assigned: "CROSS_CHECK_ASSIGNED" },
  rechecks: { reminder: "RECHECK_REMINDER", assigned: "RECHECK_ASSIGNED" },
  scans: { reminder: "SCAN_REMINDER", assigned: "SCAN_ASSIGNED" },
} as const;

export type WorkKind = keyof typeof WORK_KINDS;

export const isWorkKind = (v: unknown): v is WorkKind => typeof v === "string" && Object.prototype.hasOwnProperty.call(WORK_KINDS, v);

/** SQL: the notification types of each kind of work. */
const typesOf = (pick: (k: (typeof WORK_KINDS)[WorkKind]) => string[]) => (Object.keys(WORK_KINDS) as WorkKind[]).flatMap((kind) => pick(WORK_KINDS[kind]).map((type) => ({ kind, type })));
const whenTypes = typesOf((k) => [k.reminder, k.assigned])
  .map(({ kind, type }) => `WHEN '${type}' THEN '${kind}'`)
  .join(" ");

/**
 * One row per person and piece of work: question papers to set in the sessions that haven't
 * ended; exams to evaluate, cross-checks and rechecks of every session; exams to scan of every
 * session. A whole-class exam given out section by section is one piece of work, with its
 * sections named. Needs :inst, :open (never empty) and :withSetter.
 */
export const OPEN_WORK_SQL = `
  SELECT e."teacherId" AS "userId", 'papers'::text AS kind, e."examId" AS "referenceId", e."examId", e."createdAt" AS since, NULL::text AS sections
  FROM viaexam_exams e
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."teacherId" IS NOT NULL
    AND e.status IN (:withSetter) AND e."sessionId" IN (:open)
  UNION ALL
  SELECT a."teacherId", 'evaluations', a."examId", a."examId", MIN(a."createdAt"), string_agg(DISTINCT s."sectionName", ', ')
  FROM viaexam_evaluation_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false
  LEFT JOIN viaexam_sections s ON s."sectionId" = a."sectionId"
  WHERE a."instituteId" = :inst AND a."isActive" = true AND a."reviewedAt" IS NULL
  GROUP BY a."teacherId", a."examId"
  UNION ALL
  SELECT r."checkerId", 'crossChecks', r."examId", r."examId", MIN(r."createdAt"), NULL
  FROM viaexam_cross_check_rounds r
  JOIN viaexam_exams e ON e."examId" = r."examId" AND e."isDeleted" = false
  WHERE r."instituteId" = :inst AND r."isActive" = true AND r.status = 'open'
  GROUP BY r."checkerId", r."examId"
  UNION ALL
  SELECT ra."teacherId", 'rechecks', ra."requestId", ra."examId", ra."assignedAt", NULL
  FROM viaexam_recheck_assignments ra
  JOIN viaexam_exams e ON e."examId" = ra."examId" AND e."isDeleted" = false
  WHERE ra."instituteId" = :inst AND ra."completedAt" IS NULL
  UNION ALL
  SELECT a."scannerId", 'scans', a."examId", a."examId", MIN(a."createdAt"), string_agg(DISTINCT s."sectionName", ', ')
  FROM viaexam_exam_scanner_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false
  LEFT JOIN viaexam_sections s ON s."sectionId" = a."sectionId"
  WHERE a."instituteId" = :inst AND a."isActive" = true AND a.status = 'ASSIGNED'
  GROUP BY a."scannerId", a."examId"`;

const WORK_TYPES = typesOf((k) => [k.reminder, k.assigned]).map((x) => x.type);

const CLEAR_FINISHED_SQL = `
WITH open_work AS (
  SELECT kind, "referenceId" FROM (${OPEN_WORK_SQL}) o WHERE o."userId" = :user
)
UPDATE viaexam_notifications n
SET "isDeleted" = true, "updatedAt" = now()
WHERE n."userId" = :user AND n."instituteId" = :inst AND n."isDeleted" = false
  AND n.type IN (:types) AND n."referenceId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM open_work w
    WHERE w."referenceId" = n."referenceId" AND w.kind = CASE n.type ${whenTypes} END
  )`;

/** Reading twice within this long (two tabs, the bell and the page) checks once. */
const CLEAR_EVERY_MS = 15_000;

/**
 * Takes away the notifications about work this person no longer has: done, given to someone
 * else, or its exam deleted. Runs when they read their notifications rather than at each place
 * work can finish, so no way of finishing it can be missed. Never stops the read if it fails.
 */
export const clearFinishedWork = async (requestedBy: any): Promise<void> => {
  const userId = requestedBy?.userId;
  const instituteId = requestedBy?.instituteId;
  if (!userId || !instituteId) return;
  try {
    await memoize(`work-notifications:${userId}`, CLEAR_EVERY_MS, async () => {
      // Students and admins have none of these: nothing more to ask.
      const any = await Notification.findOne({ where: { userId, instituteId, isDeleted: false, type: WORK_TYPES }, attributes: ["id"] });
      if (!any) return 0;
      const open = await openSessionIds(instituteId);
      await sequelize.query(CLEAR_FINISHED_SQL, {
        type: QueryTypes.UPDATE,
        replacements: { user: userId, inst: instituteId, open: open.length ? open : [""], withSetter: PAPER_WITH_SETTER, types: WORK_TYPES },
      });
      return 1;
    });
  } catch (e: any) {
    logger.warn(`[Notifications] Could not clear finished work for ${userId}: ${e?.message || e}`);
  }
};
