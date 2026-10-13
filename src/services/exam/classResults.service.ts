/**
 * Class result sheet ("tabulation register") for one exam type of a session:
 * every student of a class (or one section) × every subject, with total,
 * percentage, grade, pass / fail and rank — e.g. Class 10-A, Mid Term, 2026-27.
 *
 * Built only from published results (StudentResult), so it shows exactly what
 * students see. Subjects whose results are not published yet are listed with
 * `published: false` and make the overall result INCOMPLETE.
 */

import httpStatus from "http-status";
import { Op } from "sequelize";
import Exam from "../../models/Exam.model";
import Session from "../../models/Session.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Subject from "../../models/Subject.model";
import UserModal from "../../models/User.model";
import StudentProfile from "../../models/Student.model";
import StudentResult, { RESULT_STATUS } from "../../models/StudentResult.model";
import ApiError from "../../utils/ApiError";
import { EXAM_TYPES, normalizeExamType } from "../../utils/examTypes";
import { nameKey } from "../../utils/academicNames";
import { gradeFor } from "./examRoster.service";

const clean = (v: unknown) => String(v ?? "").trim();
const round1 = (n: number) => Math.round(n * 10) / 10;

export type OverallResult = "PASS" | "FAIL" | "INCOMPLETE";

const classResults = async (admin: any, query: any) => {
  const instituteId = admin.instituteId;
  const classId = clean(query?.classId);
  if (!classId) throw new ApiError(httpStatus.BAD_REQUEST, "Choose a class.");

  const sessionInput = clean(query?.sessionId);
  const [session, cls] = await Promise.all([
    Session.findOne({
      where: sessionInput ? { sessionId: sessionInput, instituteId, isDeleted: false } : { instituteId, isActive: true, isDeleted: false },
    }),
    Class.findOne({ where: { classId, instituteId, isDeleted: false } }),
  ]);
  if (!session) throw new ApiError(httpStatus.NOT_FOUND, "Session not found.");
  if (!cls) throw new ApiError(httpStatus.NOT_FOUND, "Class not found.");

  const examType = normalizeExamType(query?.examType) ?? clean(query?.examType) ?? EXAM_TYPES[0];
  const sectionId = clean(query?.sectionId);
  const section = sectionId ? await Section.findOne({ where: { sectionId, classId, isDeleted: false } }) : null;
  if (sectionId && !section) throw new ApiError(httpStatus.NOT_FOUND, "Section not found in this class.");

  // Exams of this class / type / session: whole-class ones plus the chosen section's.
  const exams = await Exam.findAll({
    where: {
      instituteId,
      isDeleted: false,
      sessionId: session.sessionId,
      classId,
      examType: examType || EXAM_TYPES[0],
      ...(section ? { [Op.or]: [{ sectionId: null }, { sectionId: "" }, { sectionId: section.sectionId }] } : {}),
    },
    include: [{ model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false }],
    order: [["examDate", "ASC"]],
  });
  const examIds = exams.map((e) => e.examId);

  const results = examIds.length
    ? await StudentResult.findAll({ where: { examId: { [Op.in]: examIds }, isDeleted: false } })
    : [];
  const publishedExams = new Set(results.map((r) => r.examId));

  // One column per subject (a subject may have one exam per section).
  const subjects = new Map<string, { subjectId: string; subjectName: string; totalMarks: number; passingMarks: number; examIds: string[]; published: boolean }>();
  for (const e of exams as any[]) {
    const col = subjects.get(e.subjectId) ?? {
      subjectId: e.subjectId,
      subjectName: e.subject?.subjectName ?? "Subject",
      totalMarks: e.totalMarks,
      passingMarks: e.passingMarks,
      examIds: [] as string[],
      published: true,
    };
    col.examIds.push(e.examId);
    col.published = col.published && publishedExams.has(e.examId);
    subjects.set(e.subjectId, col);
  }
  const columns = [...subjects.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName));

  // Students: everyone with a published result here, plus the class roster of the session
  // (so a student missing from every published subject still shows up).
  const rosterWhere: any = { instituteId, isActive: true, session: session.sessionName, [Op.or]: [{ classId }, { className: cls.className }] };
  if (section) rosterWhere.sectionId = { [Op.in]: [section.sectionId, section.sectionName] };
  const roster = await StudentProfile.findAll({
    where: rosterWhere,
    attributes: ["userId", "rollNumber", "sectionId"],
    include: [{ model: UserModal, as: "user", attributes: ["userId", "userName"], where: { status: 1 }, required: true }],
  });
  const rosterIds = new Set(roster.map((p) => p.userId));

  // A whole-class result belongs to the chosen section if the student is in it.
  const rows = section
    ? results.filter((r) => (r.sectionId ? r.sectionId === section.sectionId : rosterIds.has(r.studentId)))
    : results;

  const studentIds = Array.from(new Set([...rosterIds, ...rows.map((r) => r.studentId)]));
  const [users, profiles] = await Promise.all([
    studentIds.length ? UserModal.findAll({ where: { userId: { [Op.in]: studentIds } }, attributes: ["userId", "userName"] }) : [],
    studentIds.length ? StudentProfile.findAll({ where: { userId: { [Op.in]: studentIds } }, attributes: ["userId", "rollNumber", "sectionId"] }) : [],
  ]);
  const nameOf = new Map(users.map((u) => [u.userId, u.userName]));
  const profileOf = new Map(profiles.map((p) => [p.userId, p]));
  const sections = await Section.findAll({ where: { classId }, attributes: ["sectionId", "sectionName"] });
  const sectionName = (key?: string | null) =>
    !key ? "" : sections.find((s) => s.sectionId === key)?.sectionName ?? sections.find((s) => nameKey(s.sectionName) === nameKey(key))?.sectionName ?? key;

  const bySubject = (studentId: string) => {
    const mine = rows.filter((r) => r.studentId === studentId);
    return new Map(columns.map((c) => [c.subjectId, mine.find((r) => c.examIds.includes(r.examId)) ?? null]));
  };

  const students = studentIds.map((studentId) => {
    const marks = bySubject(studentId);
    let obtained = 0;
    let max = 0;
    let failed = false;
    let missing = false;
    const cells = columns.map((c) => {
      const r = marks.get(c.subjectId);
      if (!r) {
        missing = true;
        return { subjectId: c.subjectId, marks: null, totalMarks: c.totalMarks, status: null as string | null, grade: null };
      }
      max += r.totalMarks;
      obtained += r.marksObtained == null ? 0 : Number(r.marksObtained);
      if (r.resultStatus === RESULT_STATUS.FAIL || r.resultStatus === RESULT_STATUS.ABSENT) failed = true;
      if (r.resultStatus === RESULT_STATUS.NOT_EVALUATED) missing = true;
      return {
        subjectId: c.subjectId,
        marks: r.marksObtained == null ? null : Number(r.marksObtained),
        totalMarks: r.totalMarks,
        status: r.resultStatus,
        grade: r.grade,
      };
    });
    const percentage = max > 0 ? round1((obtained / max) * 100) : null;
    const result: OverallResult = failed ? "FAIL" : missing || !columns.length ? "INCOMPLETE" : "PASS";
    const profile = profileOf.get(studentId);
    const rollNo = rows.find((r) => r.studentId === studentId)?.rollNo ?? profile?.rollNumber ?? "";
    return {
      studentId,
      name: nameOf.get(studentId) ?? "",
      rollNo,
      sectionName: sectionName(profile?.sectionId),
      subjects: cells,
      obtained: round1(obtained),
      max,
      percentage,
      grade: result === "INCOMPLETE" ? null : gradeFor(percentage),
      result,
      rank: null as number | null,
    };
  });

  // Rank complete results by percentage; equal percentages share a rank (1, 2, 2, 4).
  const ranked = students.filter((s) => s.result !== "INCOMPLETE" && s.percentage != null).sort((a, b) => b.percentage! - a.percentage!);
  ranked.forEach((s, i) => {
    s.rank = i > 0 && ranked[i - 1].percentage === s.percentage ? ranked[i - 1].rank : i + 1;
  });
  students.sort((a, b) => a.rollNo.localeCompare(b.rollNo, undefined, { numeric: true }) || a.name.localeCompare(b.name));

  const complete = students.filter((s) => s.result !== "INCOMPLETE");
  const avg = (list: number[]) => (list.length ? round1(list.reduce((s, n) => s + n, 0) / list.length) : null);
  const top = ranked[0];

  return {
    session: { sessionId: session.sessionId, sessionName: session.sessionName },
    class: { classId: cls.classId, className: cls.className },
    section: section ? { sectionId: section.sectionId, sectionName: section.sectionName } : null,
    examType: examType || EXAM_TYPES[0],
    examTypes: EXAM_TYPES,
    subjects: columns.map(({ examIds: _ids, ...c }) => ({
      ...c,
      average: avg(
        rows
          .filter((r) => _ids.includes(r.examId) && r.resultStatus !== RESULT_STATUS.ABSENT && r.percentage != null)
          .map((r) => Number(r.percentage))
      ),
    })),
    students,
    summary: {
      students: students.length,
      passed: complete.filter((s) => s.result === "PASS").length,
      failed: complete.filter((s) => s.result === "FAIL").length,
      incomplete: students.length - complete.length,
      average: avg(complete.map((s) => s.percentage ?? 0)),
      topper: top ? { name: top.name, rollNo: top.rollNo, percentage: top.percentage } : null,
      published: columns.filter((c) => c.published).length,
      subjects: columns.length,
    },
  };
};

export default { classResults };
