/**
 * Rules that keep the exam process consistent once real work exists.
 *
 * An exam's roster is computed from the students' current profiles (class, section,
 * session, roll number) and answer sheets are matched by roll number. So once a
 * student sits an exam, or an exam has papers / sheets / results, the fields those
 * matches depend on must not change underneath them:
 *
 *   student  — class, section, session and roll number are locked while they are on
 *              the roster of any exam in their session. To move a student, delete and
 *              add them again (their published results stay), or promote them at the
 *              end of the year.
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
import Session from "../../models/Session.model";
import Section from "../../models/Section.model";
import Scanner from "../../models/Scanner.model";
import StudentResult from "../../models/StudentResult.model";
import ExamAttendance from "../../models/ExamAttendance.model";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import StandardAnswer from "../../models/question-paper/StandardAnswer.model";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─── Students ─────────────────────────────────────────────────────────────────

export interface StudentPlacement {
  classId?: string | null;
  sectionId?: string | null;
  session?: string | null;
  rollNumber?: string | null;
  userId: string;
}

/** Exams of the student's current session whose roster includes them (same rule as examRoster). */
export const rosterExamsFor = async (profile: StudentPlacement, instituteId: string, transaction?: Transaction) => {
  if (!profile.classId || !profile.session) return [];
  const session = await Session.findOne({
    where: { instituteId, sessionName: profile.session, isDeleted: false },
    attributes: ["sessionId"],
    transaction,
  });
  if (!session) return [];

  // Older profiles store the section name in sectionId; match either form.
  const section = profile.sectionId
    ? await Section.findOne({ where: { sectionId: profile.sectionId }, attributes: ["sectionId", "sectionName"], transaction })
    : null;
  const sectionKeys = [profile.sectionId, section?.sectionName].filter(Boolean) as string[];

  return Exam.findAll({
    where: {
      instituteId,
      isDeleted: false,
      sessionId: session.sessionId,
      classId: profile.classId,
      [Op.or]: [{ sectionId: null }, { sectionId: "" }, ...(sectionKeys.length ? [{ sectionId: { [Op.in]: sectionKeys } }] : [])],
    },
    attributes: ["examId", "examType", "subjectId", "sessionId"],
    transaction,
  });
};

/** Whether class / section / session / roll number may still change, and why not. */
export const studentPlacementLock = async (profile: StudentPlacement, instituteId: string) => {
  const exams = await rosterExamsFor(profile, instituteId);
  if (!exams.length) return { locked: false as const, exams: 0, reason: null };
  return {
    locked: true as const,
    exams: exams.length,
    reason:
      `This student is on the roster of ${plural(exams.length, "exam")} in session ${profile.session}, so class, section, ` +
      `session and roll number can't be changed. To move them, delete the student and add them again in the new class — ` +
      `published results are kept.`,
  };
};

/**
 * Exams of the current session that still need this student's data: not published yet,
 * and the student already has an answer sheet or an absent mark in them. Moving the
 * student (promotion) would drop that work from the exam's roster.
 */
export const unfinishedExamsFor = async (profile: StudentPlacement, instituteId: string) => {
  const exams = await rosterExamsFor(profile, instituteId);
  if (!exams.length) return 0;
  const examIds = exams.map((e) => e.examId);
  const published = new Set(
    (
      await StudentResult.findAll({
        where: { examId: { [Op.in]: examIds }, isDeleted: false },
        attributes: ["examId"],
        group: ["examId"],
        raw: true,
      })
    ).map((r: any) => r.examId)
  );
  const open = examIds.filter((id) => !published.has(id));
  if (!open.length) return 0;

  const [sheets, absent] = await Promise.all([
    profile.rollNumber
      ? Scanner.findAll({
          where: { instituteId, examId: { [Op.in]: open }, rollNo: String(profile.rollNumber), isDeleted: false },
          attributes: ["examId"],
          raw: true,
        })
      : [],
    ExamAttendance.findAll({ where: { examId: { [Op.in]: open }, studentId: profile.userId }, attributes: ["examId"], raw: true }),
  ]);
  return new Set([...sheets, ...absent].map((r: any) => r.examId)).size;
};

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
