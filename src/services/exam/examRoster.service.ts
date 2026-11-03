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
 *
 * Sections: an exam for the whole class is still scanned and evaluated section by
 * section, as schools hand out and collect papers per classroom. Roll numbers are
 * unique only inside a section, so a sheet belongs to a student (studentId), never
 * to a roll number alone; older sheets saved without one are matched by section and
 * roll, or by roll when no other section has it.
 */

import { Op } from "sequelize";
import Exam from "../../models/Exam.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import SessionSection from "../../models/SessionSection.model";
import Subject from "../../models/Subject.model";
import Session from "../../models/Session.model";
import UserModal from "../../models/User.model";
import Scanner from "../../models/Scanner.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import ExamAttendance, { ATTENDANCE_STATUS } from "../../models/ExamAttendance.model";
import { scanQualityView, type QualitySummary } from "../answer-sheet/sheetQuality.service";
import { studentsIn } from "../student/enrollment.service";

export const EXAM_INCLUDES = [
  { model: Class, as: "class", attributes: ["classId", "className"], required: false },
  { model: Section, as: "section", attributes: ["sectionId", "sectionName"], required: false },
  { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false },
  { model: Session, as: "session", attributes: ["sessionId", "sessionName", "isActive"], required: false },
  { model: UserModal, as: "teacher", attributes: ["userId", "userName"], required: false },
];

export type RosterState = "UPLOADED" | "ABSENT" | "PENDING";

export interface RosterRow {
  studentId: string | null;
  name: string;
  rollNo: string;
  /** The student's section in the exam's session (null: no section). */
  sectionId: string | null;
  sectionName: string;
  state: RosterState;
  sheetId: string | null;
  /** The sheet row's own status (Pending, UPLOADED…); null without a sheet. */
  sheetStatus: string | null;
  fileName: string | null;
  uploadedAt: Date | null;
  evaluationId: string | null;
  evaluationStatus: string | null; // Success | Pending | Failed | null
  score: number | null;
  /** Scan quality of the sheet (ok / warn / low / unchecked), why, and each page's numbers; null until checked. */
  quality: QualitySummary | null;
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
  /** Sheets flagged as a poor scan (warn or low). */
  poorScans: number;
}

export interface SectionCounts {
  sectionId: string | null;
  sectionName: string;
  counts: RosterCounts;
}

export interface Roster {
  rows: RosterRow[];
  counts: RosterCounts;
  /** The whole exam, section by section (unfiltered). */
  sections: SectionCounts[];
}

/** A student who sits an exam. */
export interface RosterStudent {
  studentId: string;
  name: string;
  rollNo: string;
  sectionId: string | null;
}

/** One section of an exam's work: what a scanner or an evaluator is given. */
export interface ExamSection {
  sectionId: string | null;
  sectionName: string;
  students: number;
}

const clean = (v: unknown) => String(v ?? "").trim();
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 100);
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** A section as a map key and in request bodies: its id, or "" for students without a section. */
export const sectionKey = (sectionId: string | null | undefined) => clean(sectionId);

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
 * the section and roll number they have in that session. Promotion adds next year's
 * enrolment and leaves this one alone, so an exam's roster never changes after the year ends.
 */
export const studentsForExam = async (exam: any): Promise<RosterStudent[]> => {
  if (!exam.classId || !exam.sessionId) return [];
  const students = await studentsIn({ instituteId: exam.instituteId, sessionId: exam.sessionId, classId: exam.classId, section: exam.sectionId || null });
  return students.map((s) => ({ studentId: s.studentId, name: s.name, rollNo: s.rollNo, sectionId: s.sectionId ?? null }));
};

/** Names of the sections of the exam's class, by id (deleted ones too: old rosters still name them). */
const classSections = async (exam: any) => {
  const rows = exam.classId ? await Section.findAll({ where: { classId: exam.classId }, attributes: ["sectionId", "sectionName", "isDeleted"] }) : [];
  const nameOf = new Map(rows.map((s) => [s.sectionId, s.sectionName]));
  /** A section id from an id or a name as older sheets stored it ("" when it names none). */
  const idOf = (raw: unknown) => {
    const key = clean(raw);
    if (!key) return "";
    if (nameOf.has(key)) return key;
    const named = rows.filter((s) => s.sectionName.toLowerCase() === key.toLowerCase()).sort((a, b) => Number(a.isDeleted) - Number(b.isDeleted));
    return named[0]?.sectionId ?? "";
  };
  return { nameOf, idOf };
};

/**
 * The sections an exam's work is split into: its own section for a section exam; for a
 * whole-class exam, every section its students are in (null for students without one),
 * or — before anyone is enrolled — the sections the class runs in the exam's session.
 */
export const sectionsOfExam = async (exam: any, students?: RosterStudent[]): Promise<ExamSection[]> => {
  const list = students ?? (await studentsForExam(exam));
  const { nameOf } = await classSections(exam);
  const count = new Map<string, number>();
  for (const s of list) count.set(sectionKey(s.sectionId), (count.get(sectionKey(s.sectionId)) ?? 0) + 1);
  let keys = [...count.keys()];
  if (!keys.length) {
    if (exam.sectionId) keys = [exam.sectionId];
    else if (exam.classId && exam.sessionId) {
      const running = await SessionSection.findAll({ where: { sessionId: exam.sessionId, classId: exam.classId }, attributes: ["sectionId"] });
      keys = running.map((r) => r.sectionId);
    }
    if (!keys.length) keys = [""];
  }
  return keys
    .map((key) => ({ sectionId: key || null, sectionName: key ? nameOf.get(key) ?? "" : "", students: count.get(key) ?? 0 }))
    .sort((a, b) => Number(!a.sectionId) - Number(!b.sectionId) || byName(a.sectionName, b.sectionName));
};

/**
 * Finds the student a sheet is for: by section and roll number, or — with no section
 * given — by a roll number that only one section has. Used by every upload path.
 */
export const rosterIndex = async (exam: any) => {
  const students = await studentsForExam(exam);
  const { nameOf, idOf } = await classSections(exam);
  const bySectionRoll = new Map(students.map((s) => [`${sectionKey(s.sectionId)}|${s.rollNo}`, s]));
  const byRoll = new Map<string, RosterStudent[]>();
  for (const s of students) byRoll.set(s.rollNo, [...(byRoll.get(s.rollNo) ?? []), s]);
  const sections = await sectionsOfExam(exam, students);
  const known = new Set(sections.map((s) => sectionKey(s.sectionId)));

  return {
    students,
    sections,
    nameOf: (sectionId: string | null | undefined) => (sectionId ? nameOf.get(sectionId) ?? "" : ""),
    /** The exam section a client named (by id or name; "" = no section), or undefined if it isn't one. */
    section: (raw: unknown): string | null | undefined => {
      const key = clean(raw);
      const id = key ? idOf(key) : "";
      if (key && !id) return undefined;
      return known.has(id) ? id || null : undefined;
    },
    /** The student with this roll number: in `sectionId` when one is given (undefined = any section). */
    find: (sectionId: string | null | undefined, rollNo: string): { student: RosterStudent | null; problem: string | null } => {
      const roll = clean(rollNo);
      if (sectionId !== undefined) {
        const student = bySectionRoll.get(`${sectionKey(sectionId)}|${roll}`) ?? null;
        const where = sectionId ? `Section ${nameOf.get(sectionId) ?? ""}`.trim() : "this exam";
        return student ? { student, problem: null } : { student: null, problem: `Roll number ${roll} is not in ${where}.` };
      }
      const matches = byRoll.get(roll) ?? [];
      if (matches.length === 1) return { student: matches[0], problem: null };
      if (!matches.length) return { student: null, problem: `Roll number ${roll} is not on this exam's roster.` };
      const names = matches.map((m) => nameOf.get(m.sectionId ?? "") || "no section").sort(byName).join(", ");
      return { student: null, problem: `Roll number ${roll} is in more than one section (${names}). Upload it from its section.` };
    },
  };
};

export const countsOf = (rows: RosterRow[]): RosterCounts => {
  const uploaded = rows.filter((r) => r.state === "UPLOADED").length;
  const absent = rows.filter((r) => r.state === "ABSENT").length;
  const evaluated = rows.filter((r) => r.evaluationStatus === "Success").length;
  return {
    total: rows.length,
    uploaded,
    absent,
    pending: rows.length - uploaded - absent,
    handled: uploaded + absent,
    scanPercent: pct(uploaded + absent, rows.length),
    evaluated,
    evaluationFailed: rows.filter((r) => r.evaluationStatus === "Failed").length,
    evaluationPercent: pct(evaluated, uploaded),
    poorScans: rows.filter((r) => r.quality?.flag === "warn" || r.quality?.flag === "low").length,
  };
};

/**
 * The exam's roster. `sections` keeps only those sections' rows (null = no section), as a
 * scanner or evaluator given part of the exam sees it; the per-section counts always cover
 * the whole exam.
 */
export const buildRoster = async (exam: any, opts: { sections?: (string | null)[] | null } = {}): Promise<Roster> => {
  const [students, sheets, absentRows, { nameOf, idOf }] = await Promise.all([
    studentsForExam(exam),
    Scanner.findAll({
      where: sheetWhereForExam(exam),
      attributes: ["sheetId", "rollNo", "studentId", "sectionId", "section", "studentName", "fileName", "status", "createdAt", "qualityFlag", "qualityReport"],
      order: [["createdAt", "DESC"]],
    }),
    ExamAttendance.findAll({ where: { examId: exam.examId, status: ATTENDANCE_STATUS.ABSENT } }),
    classSections(exam),
  ]);

  const evaluations = sheets.length
    ? await AIEvaluation.findAll({
        where: { sheetId: { [Op.in]: sheets.map((s) => s.sheetId) } },
        attributes: ["sheetId", "evaluationId", "status", "totalScore"],
      })
    : [];
  const evalBySheet = new Map(evaluations.map((e) => [e.sheetId, e]));

  // Whose sheet is whose. Newest first, so a newer upload wins over an older one.
  const byId = new Map(students.map((s) => [s.studentId, s]));
  const byRoll = new Map<string, RosterStudent[]>();
  for (const s of students) byRoll.set(s.rollNo, [...(byRoll.get(s.rollNo) ?? []), s]);
  const sheetOf = new Map<string, any>();
  const orphans: any[] = [];
  for (const sheet of sheets) {
    let owner: RosterStudent | undefined = sheet.studentId ? byId.get(sheet.studentId) : undefined;
    if (!owner && !sheet.studentId) {
      // Saved before sheets carried their student: by section and roll, or a roll only one section has.
      const section = sheet.sectionId || idOf(sheet.section);
      const named = clean(sheet.section) !== "";
      const candidates = (byRoll.get(clean(sheet.rollNo)) ?? []).filter((s) => (section ? s.sectionId === section : !named));
      if (candidates.length === 1) owner = candidates[0];
    }
    if (owner && !sheetOf.has(owner.studentId)) sheetOf.set(owner.studentId, sheet);
    else if (!owner) orphans.push(sheet);
  }
  const absentByStudent = new Map(absentRows.map((a) => [a.studentId, a]));

  const toRow = (student: RosterStudent | null, sheet: any | null): RosterRow => {
    const ev: any = sheet ? evalBySheet.get(sheet.sheetId) : null;
    const absent = !sheet && student?.studentId ? absentByStudent.get(student.studentId) : undefined;
    const sectionId = student ? student.sectionId : sheet?.sectionId || idOf(sheet?.section) || null;
    return {
      studentId: student?.studentId ?? null,
      name: student?.name || sheet?.studentName || "",
      rollNo: student?.rollNo || clean(sheet?.rollNo),
      sectionId,
      sectionName: sectionId ? nameOf.get(sectionId) ?? "" : "",
      state: sheet ? "UPLOADED" : absent ? "ABSENT" : "PENDING",
      sheetId: sheet?.sheetId ?? null,
      sheetStatus: sheet?.status ?? null,
      fileName: sheet?.fileName ?? null,
      uploadedAt: sheet?.createdAt ?? null,
      evaluationId: ev?.evaluationId ?? null,
      evaluationStatus: ev?.status ?? null,
      score: ev?.status === "Success" && ev.totalScore != null ? Number(ev.totalScore) : null,
      quality: scanQualityView(sheet),
      absentMarkedBy: absent?.markedBy ?? null,
      absentMarkedAt: absent?.updatedAt ?? null,
    };
  };

  // A roll number may also repeat inside the orphans (two uploads of an unknown roll): keep the newest.
  const orphanRolls = new Set<string>();
  const all = [
    ...students.map((s) => toRow(s, sheetOf.get(s.studentId) ?? null)),
    ...orphans
      .filter((sheet) => {
        const key = `${sheet.sectionId || idOf(sheet.section)}|${clean(sheet.rollNo)}`;
        if (orphanRolls.has(key)) return false;
        orphanRolls.add(key);
        return true;
      })
      .map((sheet) => toRow(null, sheet)),
  ].sort((a, b) => byName(a.sectionName, b.sectionName) || a.rollNo.localeCompare(b.rollNo, undefined, { numeric: true }));

  // The sections are the students' (a sheet no student matches counts in its section, but makes none
  // of its own: no one could be given it).
  const sectionRows = new Map<string, RosterRow[]>(students.map((s) => [sectionKey(s.sectionId), []]));
  for (const row of all) sectionRows.get(sectionKey(row.sectionId))?.push(row);
  const sections: SectionCounts[] = [...sectionRows.entries()]
    .map(([key, rows]) => ({ sectionId: key || null, sectionName: key ? nameOf.get(key) ?? "" : "", counts: countsOf(rows) }))
    .sort((a, b) => Number(!a.sectionId) - Number(!b.sectionId) || byName(a.sectionName, b.sectionName));

  const only = opts.sections ? new Set(opts.sections.map(sectionKey)) : null;
  const rows = only ? all.filter((r) => only.has(sectionKey(r.sectionId))) : all;
  return { rows, counts: countsOf(rows), sections };
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
