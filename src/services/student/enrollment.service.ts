/**
 * Where each student studies in each session (class, section, roll number).
 *
 * One row per student per session (StudentEnrollment). An exam's roster, a class result
 * sheet, the student's page for a session and the scanner's roll-number matching all read
 * the row of the exam's own session, so promoting a student next year never changes what
 * last year's exams show. Promotion adds the next session's row; nothing is overwritten.
 *
 * The student profile keeps a copy of the current row (the current session's, else the
 * latest) for older screens and the student's own sign-in; syncStudentProfiles() keeps it
 * in step. This file is the only writer of both.
 */

import { Op, QueryTypes, Transaction } from "sequelize";
import { sequelize } from "../../config/sequelize";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Session from "../../models/Session.model";
import Exam from "../../models/Exam.model";
import UserModal from "../../models/User.model";
import StudentEnrollment from "../../models/StudentEnrollment.model";
import { newId } from "../../utils/idGenerator";
import { nameKey } from "../../utils/academicNames";
import { activeSession, ensureSectionRuns, findSession } from "../academic/sessionSetup.service";

const clean = (v: unknown) => String(v ?? "").trim();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ─── Placement ────────────────────────────────────────────────────────────────

export interface Place {
  classId: string;
  className: string;
  sectionId: string;
  sectionName: string;
  sessionId: string;
  sessionName: string;
}

/** "Class 9-A (2026-2027)" */
export const placeLabel = (p: { className: string; sectionName?: string | null; sessionName: string }) =>
  `Class ${p.className}${p.sectionName ? `-${p.sectionName}` : ""} (${p.sessionName})`;

/** A class by id or name ("10", "Class 10"). */
const findClass = async (input: string, instituteId: string) => {
  if (!input) return null;
  const all = await Class.findAll({ where: { instituteId, isDeleted: false }, attributes: ["classId", "className"] });
  const bare = input.replace(/^class\s+/i, "");
  return all.find((c) => c.classId === input) ?? all.find((c) => nameKey(c.className) === nameKey(input) || nameKey(c.className) === nameKey(bare)) ?? null;
};

/**
 * Resolves and checks where a student sits: the class must exist, the section must be one
 * of that class's sections (a class needs one before it takes students), and the session
 * must exist (blank = the current one). Accepts ids or names, as forms and spreadsheets send.
 */
export const resolvePlace = async (
  input: { classId?: unknown; className?: unknown; sectionId?: unknown; session?: unknown; sessionId?: unknown },
  instituteId: string
): Promise<Place | { message: string }> => {
  const cls = await findClass(clean(input.classId) || clean(input.className), instituteId);
  if (!cls) return { message: "Choose a class that exists (Master Data → Classes)." };

  const sections = await Section.findAll({ where: { classId: cls.classId, instituteId, isDeleted: false }, attributes: ["sectionId", "sectionName"] });
  const wanted = clean(input.sectionId);
  if (!sections.length) return { message: `Class ${cls.className} has no sections yet. Add one (for example A) in Master Data → Sections first.` };
  if (!wanted) return { message: `Choose a section of Class ${cls.className}.` };
  const section = sections.find((s) => s.sectionId === wanted) ?? sections.find((s) => nameKey(s.sectionName) === nameKey(wanted));
  if (!section) return { message: `Section ${wanted} is not part of Class ${cls.className}.` };

  const session = await findSession(instituteId, clean(input.sessionId) || clean(input.session));
  if (!session) return { message: "Choose a session that exists (Master Data → Sessions)." };

  return {
    classId: cls.classId,
    className: cls.className,
    sectionId: section.sectionId,
    sectionName: section.sectionName,
    sessionId: session.sessionId,
    sessionName: session.sessionName,
  };
};

/** Another student still in the section already has this roll number in that session. */
export const rollTaken = (sessionId: string, sectionId: string, rollNumber: string, exceptStudentId?: string, transaction?: Transaction) =>
  StudentEnrollment.findOne({
    where: { sessionId, sectionId, rollNumber, isActive: true, ...(exceptStudentId ? { studentId: { [Op.ne]: exceptStudentId } } : {}) },
    transaction,
  });

// ─── Reads ────────────────────────────────────────────────────────────────────

export interface EnrollmentView {
  enrollmentId: string;
  sessionId: string;
  sessionName: string;
  isCurrentSession: boolean;
  classId: string;
  className: string;
  sectionId: string | null;
  sectionName: string | null;
  rollNumber: string;
  isActive: boolean;
  startDate: string | null;
}

/** Every session a student studied in, newest first. */
export const enrollmentsOf = async (studentId: string, instituteId: string): Promise<EnrollmentView[]> => {
  const rows = (await sequelize.query(
    `SELECT e."enrollmentId", e."sessionId", se."sessionName", se."isActive" AS "isCurrentSession", se."startDate",
            e."classId", COALESCE(c."className", '') AS "className", e."sectionId", sec."sectionName",
            e."rollNumber", e."isActive"
     FROM viaexam_student_enrollments e
     JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
     LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
     LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
     WHERE e."studentId" = :sid AND e."instituteId" = :inst
     ORDER BY se."startDate" DESC`,
    { replacements: { sid: studentId, inst: instituteId }, type: QueryTypes.SELECT }
  )) as any[];
  return rows.map((r) => ({ ...r, isCurrentSession: Boolean(r.isCurrentSession), isActive: Boolean(r.isActive), startDate: r.startDate ? new Date(r.startDate).toISOString() : null }));
};

/** The student's row in the current session, else their latest one. */
export const currentEnrollment = async (studentId: string, instituteId: string, transaction?: Transaction) => {
  const rows = await StudentEnrollment.findAll({
    where: { studentId, instituteId },
    include: [{ model: Session, as: "session", attributes: ["sessionId", "sessionName", "isActive", "startDate"], required: true }],
    transaction,
  });
  return (
    rows.sort((a: any, b: any) => Number(b.session.isActive) - Number(a.session.isActive) || new Date(b.session.startDate).getTime() - new Date(a.session.startDate).getTime())[0] ??
    null
  );
};

/** The student's row in one session. */
export const enrollmentIn = (studentId: string, sessionId: string, transaction?: Transaction) =>
  StudentEnrollment.findOne({ where: { studentId, sessionId }, transaction });

// ─── Locks ────────────────────────────────────────────────────────────────────

/** Exams of the row's session whose roster includes it (same rule as examRoster). */
export const rosterExamsOf = async (e: { instituteId: string; sessionId: string; classId: string; sectionId: string | null }, transaction?: Transaction) => {
  // Older exams may store the section by name.
  const section = e.sectionId ? await Section.findOne({ where: { sectionId: e.sectionId }, attributes: ["sectionId", "sectionName"], transaction }) : null;
  const keys = [e.sectionId, section?.sectionName].filter(Boolean) as string[];
  return Exam.findAll({
    where: {
      instituteId: e.instituteId,
      isDeleted: false,
      sessionId: e.sessionId,
      classId: e.classId,
      [Op.or]: [{ sectionId: null }, { sectionId: "" }, ...(keys.length ? [{ sectionId: { [Op.in]: keys } }] : [])],
    },
    attributes: ["examId", "examType", "subjectId", "sessionId"],
    transaction,
  });
};

/** Whether the class, section and roll number of a session's row may still change, and why not. */
export const enrollmentLock = async (e: { instituteId: string; sessionId: string; classId: string; sectionId: string | null }, sessionName: string) => {
  const exams = await rosterExamsOf(e);
  if (!exams.length) return { locked: false as const, exams: 0, reason: null };
  return {
    locked: true as const,
    exams: exams.length,
    reason:
      `On the roster of ${plural(exams.length, "exam")} in ${sessionName}, so class, section and roll number for ${sessionName} can't change: ` +
      `answer sheets are matched by them. Next session's class is set by promotion.`,
  };
};

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Puts a student in a class, section and roll number for one session: creates that
 * session's row or rewrites it. Other sessions are not touched. The section is added
 * to the session's setup if it wasn't running yet.
 */
export const placeStudent = async (
  input: { instituteId: string; studentId: string; place: Place; rollNumber: string },
  transaction: Transaction
) => {
  const { instituteId, studentId, place, rollNumber } = input;
  const existing = await StudentEnrollment.findOne({ where: { studentId, sessionId: place.sessionId }, transaction });
  if (existing) {
    await existing.update({ classId: place.classId, sectionId: place.sectionId, rollNumber, isActive: true }, { transaction });
  } else {
    await StudentEnrollment.create(
      { enrollmentId: newId("enrollment"), instituteId, studentId, sessionId: place.sessionId, classId: place.classId, sectionId: place.sectionId, rollNumber, isActive: true },
      { transaction }
    );
  }
  await ensureSectionRuns(instituteId, place.sessionId, place.classId, place.sectionId, transaction);
};

/** The student left: their rows in the sessions that haven't ended stop counting (past years stay). */
export const leaveOpenSessions = async (instituteId: string, studentId: string, transaction?: Transaction) => {
  const current = await activeSession(instituteId, transaction);
  const sessions = await Session.findAll({ where: { instituteId, isDeleted: false }, attributes: ["sessionId", "isActive", "startDate"], transaction });
  const open = sessions.filter((s) => s.isActive || !current || new Date(s.startDate) > new Date(current.startDate)).map((s) => s.sessionId);
  if (open.length) await StudentEnrollment.update({ isActive: false }, { where: { studentId, sessionId: { [Op.in]: open } }, transaction });
};

/**
 * Copies each student's current row (the current session's, else their latest) onto the
 * student profile: classId, className, sectionId, session (name) and rollNumber.
 */
export const syncStudentProfiles = async (instituteId: string, studentIds: string[] | null, transaction?: Transaction) => {
  if (studentIds && !studentIds.length) return;
  await sequelize.query(
    `WITH pick AS (
       SELECT DISTINCT ON (e."studentId") e."studentId", e."classId", e."sectionId", e."rollNumber", se."sessionName"
       FROM viaexam_student_enrollments e
       JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
       WHERE e."instituteId" = :inst ${studentIds ? `AND e."studentId" IN (:ids)` : ""}
       ORDER BY e."studentId", se."isActive" DESC, se."startDate" DESC
     )
     UPDATE viaexam_student_profiles p
     SET "classId" = pick."classId",
         "className" = COALESCE(c."className", p."className"),
         "sectionId" = COALESCE(pick."sectionId", p."sectionId"),
         session = pick."sessionName",
         "rollNumber" = pick."rollNumber",
         "updatedAt" = now()
     FROM pick LEFT JOIN viaexam_classes c ON c."classId" = pick."classId"
     WHERE p."userId" = pick."studentId"
       AND (p."classId" IS DISTINCT FROM pick."classId" OR p."sectionId" IS DISTINCT FROM COALESCE(pick."sectionId", p."sectionId")
            OR p.session IS DISTINCT FROM pick."sessionName" OR p."rollNumber" IS DISTINCT FROM pick."rollNumber"
            OR p."className" IS DISTINCT FROM COALESCE(c."className", p."className"))`,
    { replacements: { inst: instituteId, ids: studentIds ?? [] }, transaction, type: QueryTypes.UPDATE }
  );
};

// ─── Rosters ──────────────────────────────────────────────────────────────────

export interface RosterStudent {
  studentId: string;
  name: string;
  rollNo: string;
  sectionId: string | null;
}

/**
 * Students still in a class (or one section of it) in a session: an exam's roster.
 * `section` may be an id or, on older exams, a section name.
 */
export const studentsIn = async (q: { instituteId: string; sessionId: string; classId: string; section?: string | null }): Promise<RosterStudent[]> => {
  let sectionId: string | null = null;
  if (q.section) {
    const byId = await Section.findOne({ where: { sectionId: q.section }, attributes: ["sectionId"] });
    const byName = byId ? null : await Section.findOne({ where: { classId: q.classId, sectionName: q.section, isDeleted: false }, attributes: ["sectionId"] });
    sectionId = byId?.sectionId ?? byName?.sectionId ?? q.section;
  }
  const rows = await StudentEnrollment.findAll({
    where: { instituteId: q.instituteId, sessionId: q.sessionId, classId: q.classId, isActive: true, ...(sectionId ? { sectionId } : {}) },
    attributes: ["studentId", "rollNumber", "sectionId"],
    include: [{ model: UserModal, as: "student", attributes: ["userId", "userName"], where: { status: 1, isDeleted: false }, required: true }],
  });
  return rows.map((r: any) => ({ studentId: r.studentId, name: r.student?.userName ?? "", rollNo: clean(r.rollNumber), sectionId: r.sectionId }));
};

/**
 * Who an answer sheet belongs to: the student with that roll number in the sheet's class
 * (and section) in its exam's session. Null when no one matches, or the match isn't unique.
 */
export const studentForSheet = async (sheet: { instituteId: string; examId?: string | null; classId: string; section?: string | null; rollNo: string }) => {
  const exam = sheet.examId ? await Exam.findOne({ where: { examId: sheet.examId }, attributes: ["sessionId", "sectionId"] }) : null;
  const sessionId = exam?.sessionId ?? (await activeSession(sheet.instituteId))?.sessionId;
  if (!sessionId) return null;
  const sectionKey = clean(sheet.section) || clean(exam?.sectionId);
  let sectionId: string | null = null;
  if (sectionKey) {
    const section =
      (await Section.findOne({ where: { sectionId: sectionKey }, attributes: ["sectionId"] })) ??
      (await Section.findOne({ where: { classId: sheet.classId, sectionName: sectionKey, isDeleted: false }, attributes: ["sectionId"] }));
    sectionId = section?.sectionId ?? null;
  }
  const rows = await StudentEnrollment.findAll({
    where: { sessionId, classId: sheet.classId, rollNumber: clean(sheet.rollNo), isActive: true, ...(sectionId ? { sectionId } : {}) },
    attributes: ["studentId"],
    limit: 2,
  });
  return rows.length === 1 ? rows[0].studentId : null;
};
