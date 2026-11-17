/**
 * Keeps an exam's scanner and evaluator assignments on sections the exam really has.
 *
 * Work is given out per section of an exam (examRoster.sectionsOfExam: the sections its
 * students are in, or the class's sections for the session while it has no students yet).
 * Students join, move and leave after that, so a row can be left on a section that covers
 * nobody, typically a scanner given "students without a section" before the students were
 * put in one. Its scanner then opens the exam and sees no students, its teacher can't open
 * the sheets, and the section that does have the students shows no one.
 *
 * syncAssignmentsToSections() makes such a row follow the students:
 *   - a row for "students without a section", when the exam has no such students now, and a
 *     row for a section that is no longer part of the class this session, are stale;
 *   - the oldest stale row takes the exam's sections that have nobody of its kind, and its
 *     work starts again there (uploading open, review not done); any other is retired;
 *   - a row for a section of the class that only has no students *yet* is left alone (the
 *     admin may give out sections before the students are enrolled).
 * Exams with published results are never changed. The exam workflow runs it when an exam's
 * assignments are opened; the "assignment-sections" maintenance task runs it for every exam.
 */

import { type Transaction } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import Exam from "../../models/Exam.model";
import SessionSection from "../../models/SessionSection.model";
import StudentResult from "../../models/StudentResult.model";
import ExamScannerAssignment, { SCAN_STATUS } from "../../models/ExamScannerAssignment.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import ScanReopenRequest, { REOPEN_STATUS } from "../../models/ScanReopenRequest.model";
import EvaluationReopenRequest, { EVAL_REOPEN_STATUS } from "../../models/EvaluationReopenRequest.model";
import { newId } from "../../utils/idGenerator";
import { defineMaintenanceTask } from "../../queue/maintenance";
import { sectionKey, sectionsOfExam } from "./examRoster.service";

type Kind = {
  name: string;
  model: any;
  /** The same person on another section (a new row), with their work not started. */
  copy: (row: any) => Record<string, unknown>;
  /** Their work starts again on the row that moves. */
  restart: Record<string, unknown>;
  /** Answers their open requests to re-open the work: approved when it re-opens, rejected when the row is retired. */
  settle: (assignmentId: string, reopened: boolean, note: string, transaction: Transaction) => Promise<unknown>;
};

const KINDS: Kind[] = [
  {
    name: "scanner",
    model: ExamScannerAssignment,
    copy: (row) => ({ assignmentId: newId("scannerAssignment"), scannerId: row.scannerId }),
    restart: { status: SCAN_STATUS.ASSIGNED, completedAt: null, completedBy: null },
    settle: (assignmentId, reopened, note, transaction) =>
      ScanReopenRequest.update(
        { status: reopened ? REOPEN_STATUS.APPROVED : REOPEN_STATUS.REJECTED, decidedBy: null, decidedAt: new Date(), decisionNote: note },
        { where: { assignmentId, status: REOPEN_STATUS.PENDING }, transaction }
      ),
  },
  {
    name: "evaluator",
    model: EvaluationAssignment,
    copy: (row) => ({ assignmentId: newId("assignment"), teacherId: row.teacherId }),
    restart: { reviewedAt: null, reviewedBy: null },
    settle: (assignmentId, reopened, note, transaction) =>
      EvaluationReopenRequest.update(
        { status: reopened ? EVAL_REOPEN_STATUS.APPROVED : EVAL_REOPEN_STATUS.REJECTED, decidedBy: null, decidedAt: new Date(), decisionNote: note },
        { where: { assignmentId, status: EVAL_REOPEN_STATUS.PENDING }, transaction }
      ),
  },
];

const MOVED_NOTE = "Re-opened: the exam's students are in a different section now.";
const RETIRED_NOTE = "Closed: this section has none of the exam's students now.";

export type SyncResult = { moved: number; retired: number };

/** Moves this exam's stale assignments to the sections it has now (see the header). Never throws. */
export const syncAssignmentsToSections = async (exam: any): Promise<SyncResult> => {
  const done: SyncResult = { moved: 0, retired: 0 };
  if (!exam?.examId) return done;
  try {
    // Cheap checks first: almost every call finds nothing to change.
    const active = await Promise.all(
      KINDS.map((k) => k.model.findAll({ where: { examId: exam.examId, isActive: true }, attributes: ["sectionId"], raw: true }) as Promise<any[]>)
    );
    if (!active.some((rows) => rows.length)) return done;

    const sections = await sectionsOfExam(exam);
    const has = new Set(sections.map((s) => sectionKey(s.sectionId)));
    if (active.every((rows) => rows.every((r) => has.has(sectionKey(r.sectionId))))) return done;

    // Sections of the class this session (and the exam's own): a row there only waits for students.
    const sessionSections =
      exam.classId && exam.sessionId ? await SessionSection.findAll({ where: { sessionId: exam.sessionId, classId: exam.classId }, attributes: ["sectionId"] }) : [];
    const stillPart = new Set([...sessionSections.map((s) => sectionKey(s.sectionId)), sectionKey(exam.sectionId)].filter(Boolean));
    const isStale = (row: any) => {
      const key = sectionKey(row.sectionId);
      return !has.has(key) && (key === "" || !stillPart.has(key));
    };
    if (!active.some((rows) => rows.some(isStale))) return done;
    if (await StudentResult.count({ where: { examId: exam.examId, isDeleted: false } })) return done;

    await sequelize.transaction(async (transaction) => {
      // The lock assignScanner and publishing take, so they can't interleave with this.
      await Exam.findOne({ where: { examId: exam.examId }, transaction, lock: transaction.LOCK.UPDATE });
      if (await StudentResult.count({ where: { examId: exam.examId, isDeleted: false }, transaction })) return;

      for (const kind of KINDS) {
        const rows: any[] = await kind.model.findAll({ where: { examId: exam.examId, isActive: true }, order: [["createdAt", "ASC"]], transaction });
        const taken = new Set(rows.filter((r) => has.has(sectionKey(r.sectionId))).map((r) => sectionKey(r.sectionId)));
        const free = sections.filter((s) => !taken.has(sectionKey(s.sectionId)));
        const stale = rows.filter(isStale);

        for (const [i, row] of stale.entries()) {
          if (i === 0 && free.length) {
            const [first, ...rest] = free;
            await row.update({ sectionId: first.sectionId, ...kind.restart }, { transaction });
            for (const section of rest) {
              await kind.model.create(
                { ...kind.copy(row), instituteId: row.instituteId, examId: row.examId, sectionId: section.sectionId, assignedBy: row.assignedBy, note: row.note, isActive: true },
                { transaction }
              );
            }
            await kind.settle(row.assignmentId, true, MOVED_NOTE, transaction);
            done.moved++;
            logger.info(`[assignment-sections] ${exam.examId}: ${kind.name} ${row.assignmentId} moved to ${free.length} section(s) that had nobody.`);
          } else {
            await row.update({ isActive: false, unassignedAt: new Date() }, { transaction });
            await kind.settle(row.assignmentId, false, RETIRED_NOTE, transaction);
            done.retired++;
            logger.info(`[assignment-sections] ${exam.examId}: ${kind.name} ${row.assignmentId} retired; every section already has someone.`);
          }
        }
      }
    });
  } catch (err: any) {
    // Never breaks the request that opened the exam; the maintenance task tries again.
    logger.warn(`[assignment-sections] ${exam.examId}: could not sync assignments: ${err?.message || err}`);
  }
  return done;
};

/** syncAssignmentsToSections for every exam that has active assignments. */
export const syncAllAssignmentsToSections = async () => {
  const examIds = new Set<string>();
  for (const kind of KINDS) {
    const rows: any[] = await kind.model.findAll({ where: { isActive: true }, attributes: ["examId"], group: ["examId"], raw: true });
    rows.forEach((r) => examIds.add(r.examId));
  }
  const totals = { exams: examIds.size, moved: 0, retired: 0 };
  for (const examId of examIds) {
    const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
    if (!exam) continue;
    const result = await syncAssignmentsToSections(exam);
    totals.moved += result.moved;
    totals.retired += result.retired;
  }
  return totals;
};

defineMaintenanceTask("assignment-sections", { everyMs: 15 * 60_000 }, syncAllAssignmentsToSections);
