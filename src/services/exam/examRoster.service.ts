/**
 * The roster of one exam: every student who should sit it, with their answer
 * sheet, absent mark and evaluation. Scanner progress, the evaluator's "100%
 * evaluated" check and result publishing all read from here, so the three
 * always agree on who counts.
 *
 * Who sits an exam: students enrolled in the exam's class (and section, when
 * the exam has one) in the exam's session (services/student/enrollment.service).
 * Which sheets belong to it: rows tagged with the exam id, plus older rows that
 * were stored without one but match the exam's class / section / subject /
 * exam type and were uploaded after the exam was created.
 */

import { Op } from "sequelize";
import Exam from "../../models/Exam.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Subject from "../../models/Subject.model";
import Session from "../../models/Session.model";
import UserModal from "../../models/User.model";
import Scanner from "../../models/Scanner.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import ExamAttendance, { ATTENDANCE_STATUS } from "../../models/ExamAttendance.model";
import { studentsIn } from "../student/enrollment.service";

export const EXAM_INCLUDES = [
  { model: Class, as: "class", attributes: ["classId", "className"], required: false },
  { model: Section, as: "section", attributes: ["sectionId", "sectionName"], required: false },
  { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false },
  { model: Session, as: "session", attributes: ["sessionId", "sessionName"], required: false },
  { model: UserModal, as: "teacher", attributes: ["userId", "userName"], required: false },
];

export type RosterState = "UPLOADED" | "ABSENT" | "PENDING";

export interface RosterRow {
  studentId: string | null;
  name: string;
  rollNo: string;
  state: RosterState;
  sheetId: string | null;
  fileName: string | null;
  uploadedAt: Date | null;
  evaluationId: string | null;
  evaluationStatus: string | null; // Success | Pending | Failed | null
  score: number | null;
  absentMarkedBy: string | null;
  absentMarkedAt: Date | null;
}

export interface RosterCounts {
  total: number;
  uploaded: number;
  absent: number;
  pending: number;
  /** uploaded + absent: what the scanner has dealt with. */
  handled: number;
  scanPercent: number;
  evaluated: number;
  evaluationFailed: number;
  /** evaluated / uploaded, 100 when nothing was uploaded. */
  evaluationPercent: number;
}

export interface Roster {
  rows: RosterRow[];
  counts: RosterCounts;
}

const clean = (v: unknown) => String(v ?? "").trim();
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 100);

/** Loads an exam of the institute with class/section/subject/session/teacher. */
export const loadExam = (instituteId: string, examId: string) =>
  Exam.findOne({
    where: { examId: clean(examId), instituteId, isDeleted: false },
    include: EXAM_INCLUDES,
  }) as Promise<any>;

/** Where-clause for the answer sheets of one exam (see header comment). */
export const sheetWhereForExam = (exam: any) => {
  const classKeys = [exam.classId, exam.class?.className].filter(Boolean);
  const sectionKeys = [exam.sectionId, exam.section?.sectionName].filter(Boolean);
  const legacy: any = {
    examId: null,
    subjectId: exam.subjectId,
    examType: exam.examType,
    createdAt: { [Op.gte]: exam.createdAt },
  };
  if (classKeys.length) legacy.classId = { [Op.in]: classKeys };
  if (sectionKeys.length) legacy.section = { [Op.in]: sectionKeys };
  return {
    instituteId: exam.instituteId,
    isDeleted: false,
    [Op.or]: [{ examId: exam.examId }, legacy],
  };
};

/**
 * Students who sit this exam: those in its class (and section) in its own session, with
 * the roll number they have in that session. Promotion adds next year's enrolment and
 * leaves this one alone, so an exam's roster never changes after the year ends.
 */
export const studentsForExam = async (exam: any) => {
  if (!exam.classId || !exam.sessionId) return [];
  const students = await studentsIn({ instituteId: exam.instituteId, sessionId: exam.sessionId, classId: exam.classId, section: exam.sectionId || null });
  return students.map((s) => ({ studentId: s.studentId, name: s.name, rollNo: s.rollNo }));
};

/** Roll numbers of the students who sit this exam (uploads for anyone else are refused). */
export const rosterRolls = async (instituteId: string, examId: string): Promise<Set<string> | null> => {
  const exam = await loadExam(instituteId, examId);
  if (!exam) return null;
  return new Set((await studentsForExam(exam)).map((s) => s.rollNo).filter(Boolean));
};

export const buildRoster = async (exam: any): Promise<Roster> => {
  const [students, sheets, absentRows] = await Promise.all([
    studentsForExam(exam),
    Scanner.findAll({
      where: sheetWhereForExam(exam),
      attributes: ["sheetId", "rollNo", "studentName", "fileName", "createdAt"],
      order: [["createdAt", "DESC"]],
    }),
    ExamAttendance.findAll({ where: { examId: exam.examId, status: ATTENDANCE_STATUS.ABSENT } }),
  ]);

  const evaluations = sheets.length
    ? await AIEvaluation.findAll({
        where: { sheetId: { [Op.in]: sheets.map((s) => s.sheetId) } },
        attributes: ["sheetId", "evaluationId", "status", "totalScore"],
      })
    : [];
  const evalBySheet = new Map(evaluations.map((e) => [e.sheetId, e]));

  const sheetByRoll = new Map<string, any>();
  for (const sheet of sheets) {
    const roll = clean(sheet.rollNo);
    if (roll && !sheetByRoll.has(roll)) sheetByRoll.set(roll, sheet); // newest upload wins
  }
  const absentByStudent = new Map(absentRows.map((a) => [a.studentId, a]));

  const toRow = (student: { studentId: string | null; name: string; rollNo: string }, sheet: any | null): RosterRow => {
    const ev: any = sheet ? evalBySheet.get(sheet.sheetId) : null;
    const absent = !sheet && student.studentId ? absentByStudent.get(student.studentId) : undefined;
    return {
      studentId: student.studentId,
      name: student.name || sheet?.studentName || "",
      rollNo: student.rollNo || clean(sheet?.rollNo),
      state: sheet ? "UPLOADED" : absent ? "ABSENT" : "PENDING",
      sheetId: sheet?.sheetId ?? null,
      fileName: sheet?.fileName ?? null,
      uploadedAt: sheet?.createdAt ?? null,
      evaluationId: ev?.evaluationId ?? null,
      evaluationStatus: ev?.status ?? null,
      score: ev?.status === "Success" && ev.totalScore != null ? Number(ev.totalScore) : null,
      absentMarkedBy: absent?.markedBy ?? null,
      absentMarkedAt: absent?.updatedAt ?? null,
    };
  };

  const rows = students.map((s) => toRow(s, sheetByRoll.get(s.rollNo) ?? null));
  const known = new Set(students.map((s) => s.rollNo));
  for (const [roll, sheet] of sheetByRoll) {
    if (!known.has(roll)) rows.push(toRow({ studentId: null, name: sheet.studentName ?? "", rollNo: roll }, sheet));
  }
  rows.sort((a, b) => a.rollNo.localeCompare(b.rollNo, undefined, { numeric: true }));

  const uploaded = rows.filter((r) => r.state === "UPLOADED").length;
  const absent = rows.filter((r) => r.state === "ABSENT").length;
  const evaluated = rows.filter((r) => r.evaluationStatus === "Success").length;
  const counts: RosterCounts = {
    total: rows.length,
    uploaded,
    absent,
    pending: rows.length - uploaded - absent,
    handled: uploaded + absent,
    scanPercent: pct(uploaded + absent, rows.length),
    evaluated,
    evaluationFailed: rows.filter((r) => r.evaluationStatus === "Failed").length,
    evaluationPercent: pct(evaluated, uploaded),
  };
  return { rows, counts };
};

/** Grade bands used on result pages. */
export const gradeFor = (percentage: number | null): string | null => {
  if (percentage == null) return null;
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B+";
  if (percentage >= 60) return "B";
  if (percentage >= 50) return "C+";
  if (percentage >= 40) return "C";
  if (percentage >= 33) return "D";
  return "E";
};
