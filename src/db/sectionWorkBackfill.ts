/**
 * Exam work by section (services/exam/examRoster.service): a scanner and an evaluator are
 * given sections of an exam, and every new answer sheet names the student it belongs to.
 *
 * Every start: the old one-per-exam keys are dropped and the per-section ones created.
 * Once per database (a row in viaexam_data_jobs, under an advisory lock like
 * sessionScopeBackfill), each active scanner / evaluator of a whole exam becomes one row
 * per section, with the same person, status and review, so exams already in progress
 * keep their people. Older sheets are left as they are: the roster still matches them by
 * section and roll number.
 */

import { Op, QueryTypes, type Transaction } from "sequelize";
import logger from "../config/logger";
import { sequelize } from "../config/sequelize";
import Exam from "../models/Exam.model";
import ExamScannerAssignment from "../models/ExamScannerAssignment.model";
import EvaluationAssignment from "../models/EvaluationAssignment.model";
import { sectionsOfExam } from "../services/exam/examRoster.service";
import { newId } from "../utils/idGenerator";

const JOB = "section-work-v1";

// The keys they replace: one scanner per exam, and one sheet per class + section + roll
// (which also caught next year's sheet of the same roll number).
const DROP_OLD_KEYS = [
  `DROP INDEX IF EXISTS "viaexam_exam_scanner_assignments_one_active"`,
  `DROP INDEX IF EXISTS "unique_sheet_per_student_per_exam"`,
];

const CREATE_KEYS = [
  `CREATE UNIQUE INDEX IF NOT EXISTS "viaexam_exam_scanner_assignments_one_active_section"
     ON "viaexam_exam_scanner_assignments" ("examId", (COALESCE("sectionId", ''))) WHERE "isActive" = true`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "viaexam_evaluation_assignments_one_active_section"
     ON "viaexam_evaluation_assignments" ("examId", (COALESCE("sectionId", ''))) WHERE "isActive" = true`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "viaexam_answer_sheets_exam_student"
     ON "viaexam_answer_sheets" ("examId", "studentId") WHERE "isDeleted" = false AND "examId" IS NOT NULL AND "studentId" IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "viaexam_answer_sheets_exam_section" ON "viaexam_answer_sheets" ("examId", "sectionId") WHERE "isDeleted" = false`,
];

/** One active row per section for each active scanner / evaluator that covered a whole exam. */
const splitAssignments = async (transaction: Transaction) => {
  let added = 0;
  const models: [any, (row: any) => object][] = [
    [ExamScannerAssignment, (r) => ({ assignmentId: newId("scannerAssignment"), scannerId: r.scannerId, status: r.status, completedAt: r.completedAt, completedBy: r.completedBy })],
    [EvaluationAssignment, (r) => ({ assignmentId: newId("assignment"), teacherId: r.teacherId, reviewedAt: r.reviewedAt, reviewedBy: r.reviewedBy })],
  ];
  for (const [model, own] of models) {
    const rows: any[] = await model.findAll({ where: { isActive: true, sectionId: null }, transaction });
    if (!rows.length) continue;
    const exams = await Exam.findAll({ where: { examId: { [Op.in]: [...new Set(rows.map((r) => r.examId))] } }, transaction });
    const examOf = new Map(exams.map((e) => [e.examId, e]));
    for (const row of rows) {
      const exam = examOf.get(row.examId);
      if (!exam) continue;
      const [first, ...rest] = (await sectionsOfExam(exam)).map((s) => s.sectionId);
      if (first === undefined || (first === null && !rest.length)) continue; // a class without sections
      await row.update({ sectionId: first }, { transaction });
      for (const sectionId of rest) {
        await model.create(
          { ...own(row), instituteId: row.instituteId, examId: row.examId, sectionId, assignedBy: row.assignedBy, note: row.note, isActive: true, createdAt: row.createdAt },
          { transaction }
        );
        added++;
      }
    }
  }
  return added;
};

export const runSectionWorkBackfill = async () => {
  for (const sql of DROP_OLD_KEYS) await sequelize.query(sql).catch((err) => logger.warn(`[${JOB}] ${err?.message}`));
  await sequelize.query(
    `CREATE TABLE IF NOT EXISTS viaexam_data_jobs (name VARCHAR(100) PRIMARY KEY, "ranAt" TIMESTAMPTZ NOT NULL DEFAULT now(), detail JSONB)`
  );
  await sequelize.transaction(async (t) => {
    await sequelize.query(`SELECT pg_advisory_xact_lock(hashtext('viaexam:${JOB}'))`, { transaction: t });
    const done = (await sequelize.query(`SELECT 1 FROM viaexam_data_jobs WHERE name = :job`, { replacements: { job: JOB }, type: QueryTypes.SELECT, transaction: t })) as any[];
    if (done.length) return;

    logger.info(`[${JOB}] Splitting active exam assignments by section…`);
    const detail = { assignmentsAdded: await splitAssignments(t) };
    await sequelize.query(`INSERT INTO viaexam_data_jobs (name, detail) VALUES (:job, CAST(:detail AS JSONB))`, {
      replacements: { job: JOB, detail: JSON.stringify(detail) },
      transaction: t,
    });
    logger.info(`[${JOB}] Done: ${JSON.stringify(detail)}`);
  });
  for (const sql of CREATE_KEYS) await sequelize.query(sql).catch((err) => logger.warn(`[${JOB}] Key skipped: ${err?.message}`));
};
