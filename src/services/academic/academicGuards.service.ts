/**
 * Rules that keep the exam process consistent once real work exists.
 *
 * An exam's roster is the students enrolled in its class (and section) in its session,
 * and answer sheets are matched by roll number. So once an exam has papers / sheets /
 * results, the fields those matches depend on must not change underneath them:
 *
 *   student  — a session's class, section and roll number are locked while the student
 *              is on the roster of an exam of that session (services/student/enrollment).
 *   exam     — session, class, section, subject and type are locked once a question
 *              paper, model answer, scanner / evaluator, sheet or result exists; marks
 *              once a sheet or result exists.
 *   class / section — can't be renamed while exams use them.
 */

import { Op, Transaction } from "sequelize";
import Exam from "../../models/Exam.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import Scanner from "../../models/Scanner.model";
import StudentResult from "../../models/StudentResult.model";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import StandardAnswer from "../../models/question-paper/StandardAnswer.model";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─── Exams ────────────────────────────────────────────────────────────────────

export interface ExamUsage {
  papers: number;
  answers: number;
  scanner: number;
  evaluator: number;
  sheets: number;
  results: number;
}

export const examUsage = async (examId: string): Promise<ExamUsage> => {
  const [papers, answers, scanner, evaluator, sheets, results] = await Promise.all([
    QuestionPaper.count({ where: { examId } }),
    StandardAnswer.count({ where: { examId } }),
    ExamScannerAssignment.count({ where: { examId, isActive: true } }),
    EvaluationAssignment.count({ where: { examId, isActive: true } }),
    Scanner.count({ where: { examId, isDeleted: false } }),
    StudentResult.count({ where: { examId, isDeleted: false } }),
  ]);
  return { papers, answers, scanner, evaluator, sheets, results };
};

/** Why the exam's identity (session, class, section, subject, type) is locked, or null. */
export const examStructureLock = (u: ExamUsage): string | null => {
  const used = [
    u.papers && plural(u.papers, "question paper"),
    u.answers && plural(u.answers, "model answer"),
    u.scanner && "a scanner assigned",
    u.evaluator && "an evaluator assigned",
    u.sheets && plural(u.sheets, "answer sheet"),
    u.results && "published results",
  ].filter(Boolean);
  return used.length
    ? `This exam already has ${used.join(", ")}, so its session, class, section, subject and type can't change. ` +
        `Create a new exam instead.`
    : null;
};

/** Why the marks are locked, or null. */
export const examMarksLock = (u: ExamUsage): string | null =>
  u.sheets || u.results ? "Marks can't change after answer sheets are uploaded or results are published." : null;

// ─── Master data ──────────────────────────────────────────────────────────────

/** Number of live exams that use a class / section / subject (for rename locks). */
export const examsUsing = (
  instituteId: string,
  where: { classId?: string; sectionId?: string; subjectId?: string },
  transaction?: Transaction
) => Exam.count({ where: { instituteId, isDeleted: false, ...where }, transaction });

/** Live exams per class / section / subject id, for the master-data lists. */
export const examCountsBy = async (instituteId: string, key: "classId" | "sectionId" | "subjectId") => {
  const rows = (await Exam.findAll({
    where: { instituteId, isDeleted: false },
    attributes: [key, [Exam.sequelize!.fn("COUNT", Exam.sequelize!.col("id")), "count"]],
    group: [key],
    raw: true,
  })) as any[];
  return new Map<string, number>(rows.filter((r) => r[key]).map((r) => [String(r[key]), Number(r.count)]));
};

export const renameLockMessage = (what: string, exams: number) =>
  `${what} is used by ${plural(exams, "exam")}, so it can't be renamed — the name is printed on answer sheets and results.`;

// ─── Staff (teachers, scanners) ───────────────────────────────────────────────

const roleOf = async (userId: string, instituteId: string) => {
  const user = await UserModal.findOne({ where: { userId, instituteId }, include: [{ model: Role, as: "role", attributes: ["role"] }] });
  return { user, role: String((user as any)?.role?.role ?? "").toUpperCase() };
};

/** The user, only if they are a member of the institute with this role. */
export const findStaff = async (userId: string, instituteId: string, role: "TEACHER" | "SCANNER") => {
  const found = await roleOf(userId, instituteId);
  return found.user && found.role === role ? found.user : null;
};

/**
 * Work a teacher still has to finish. A teacher with any of it can't be removed
 * until the admin gives the work to someone else.
 */
export const teacherOpenWork = async (teacherId: string, instituteId: string) => {
  const [papers, evaluations, rechecks] = await Promise.all([
    // Exams whose paper they must still set / fix / get approved.
    Exam.count({
      where: { instituteId, teacherId, isDeleted: false, status: { [Op.in]: ["Draft", "Paper Created", "Pending Approval", "Rejected"] } },
    }),
    EvaluationAssignment.count({ where: { instituteId, teacherId, isActive: true, reviewedAt: null } }),
    RecheckAssignment.count({ where: { instituteId, teacherId, completedAt: null } }),
  ]);
  const parts = [
    papers && plural(papers, "question paper") + " to set",
    evaluations && plural(evaluations, "exam") + " to evaluate",
    rechecks && plural(rechecks, "recheck") + " to finish",
  ].filter(Boolean);
  return {
    total: papers + evaluations + rechecks,
    message: parts.length
      ? `This teacher still has ${parts.join(", ")}. Give that work to another teacher first (Manage Exams, Assign Evaluators, Recheck Requests).`
      : null,
  };
};

/** Exams a scanner still has to upload sheets for. */
export const scannerOpenWork = async (scannerId: string, instituteId: string) => {
  const open = await ExamScannerAssignment.count({ where: { instituteId, scannerId, isActive: true, status: "ASSIGNED" } });
  return {
    total: open,
    message: open
      ? `This scanner still has ${plural(open, "exam")} to upload. Assign those exams to another scanner first (Exam Workflow).`
      : null,
  };
};
