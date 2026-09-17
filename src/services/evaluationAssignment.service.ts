// Evaluation assignment: after an exam's paper is approved the admin picks a teacher
// of that subject (any class) to evaluate its uploaded answer sheets.
// The roster used by the evaluation pages is built here too, so names are masked
// on the server for assigned evaluators (see evaluationAccess.service.ts).

import httpStatus from "http-status";
import { Op } from "sequelize";
import { sequelize } from "../config/sequelize";
import Exam from "../modals/Exam.modal";
import Class from "../modals/Class.modal";
import Section from "../modals/Section.modal";
import Subject from "../modals/Subject.modal";
import Session from "../modals/Session.modal";
import UserModal from "../modals/User.modal";
import Role from "../modals/Role.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import Scanner from "../modals/Scanner.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import Notification from "../modals/Notification.modal";
import EvaluationAssignment from "../modals/EvaluationAssignment.modal";
import StudentService from "./student.service";
import RegHelper from "../utils/helper";
import ApiError from "../utils/ApiError";
import { specialisesIn } from "../utils/specialization";
import {
  accessForSheet,
  getTeacherScope,
  isAssignedEvaluator,
  isTeacherRequester,
  maskId,
  maskName,
  maskRoll,
  type SheetAccess,
} from "./evaluationAccess.service";

/** Exams whose paper is approved can be evaluated. */
export const EVALUATION_READY_STATUSES = ["Approved", "Live", "Completed"];

const EXAM_INCLUDES = [
  { model: Class, as: "class", attributes: ["classId", "className"], required: false },
  { model: Section, as: "section", attributes: ["sectionId", "sectionName"], required: false },
  { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false },
  { model: Session, as: "session", attributes: ["sessionId", "sessionName"], required: false },
  { model: UserModal, as: "teacher", attributes: ["userId", "userName"], required: false },
];

const clean = (v: unknown) => String(v ?? "").trim();

/** Where-clause for the uploaded sheets of one exam (sheets store class/section as id or name). */
function sheetWhereForExam(exam: any, instituteId: string) {
  const where: any = {
    instituteId,
    subjectId: exam.subjectId,
    examType: exam.examType,
    isDeleted: false,
    classId: { [Op.in]: [exam.classId, exam.class?.className].filter(Boolean) },
  };
  const sections = [exam.sectionId, exam.section?.sectionName].filter(Boolean);
  if (sections.length) where.section = { [Op.in]: sections };
  return where;
}

async function sheetCounts(exam: any, instituteId: string) {
  const sheets = await Scanner.findAll({ where: sheetWhereForExam(exam, instituteId), attributes: ["sheetId"] });
  const sheetIds = sheets.map((s) => s.sheetId);
  const evals = sheetIds.length
    ? await AIEvaluation.findAll({ where: { sheetId: { [Op.in]: sheetIds } }, attributes: ["status"] })
    : [];
  return {
    uploadedSheets: sheetIds.length,
    evaluatedSheets: evals.filter((e) => e.status === "Success").length,
    failedSheets: evals.filter((e) => e.status === "Failed").length,
  };
}

async function notify(instituteId: string, userId: string, type: string, title: string, message: string, referenceId: string) {
  try {
    await Notification.create({
      notificationId: await RegHelper.generateUserId(),
      instituteId,
      userId,
      type,
      title,
      message,
      referenceId,
    });
  } catch (_) {
    // non-blocking
  }
}

const examLabel = (exam: any) =>
  `${exam.subject?.subjectName ?? "Subject"} · ${exam.examType} · Class ${exam.class?.className ?? exam.classId}`;

// ── Admin: approved exams with their evaluator ───────────────────────────────

const listExams = async (admin: any, query: any) => {
  const instituteId = admin.instituteId;
  const search = clean(query?.search).toLowerCase();

  const exams: any[] = await Exam.findAll({
    where: { instituteId, isDeleted: false, status: { [Op.in]: EVALUATION_READY_STATUSES } },
    include: EXAM_INCLUDES,
    order: [["updatedAt", "DESC"]],
  });

  const active = exams.length
    ? await EvaluationAssignment.findAll({
        where: { instituteId, isActive: true, examId: { [Op.in]: exams.map((e) => e.examId) } },
      })
    : [];
  const evaluatorIds = Array.from(new Set(active.map((a) => a.teacherId)));
  const evaluators = evaluatorIds.length
    ? await UserModal.findAll({ where: { userId: { [Op.in]: evaluatorIds } }, attributes: ["userId", "userName", "emailId"] })
    : [];
  const evaluatorById = new Map(evaluators.map((u) => [u.userId, u]));
  const assignmentByExam = new Map(active.map((a) => [a.examId, a]));

  const rows = await Promise.all(
    exams.map(async (exam) => {
      const assignment = assignmentByExam.get(exam.examId);
      const evaluator = assignment ? evaluatorById.get(assignment.teacherId) : null;
      const counts = await sheetCounts(exam, instituteId);
      return {
        examId: exam.examId,
        examType: exam.examType,
        status: exam.status,
        examDate: exam.examDate,
        classId: exam.classId,
        className: exam.class?.className ?? "",
        sectionName: exam.section?.sectionName ?? "",
        subjectId: exam.subjectId,
        subjectName: exam.subject?.subjectName ?? "",
        sessionName: exam.session?.sessionName ?? "",
        paperSetterId: exam.teacherId,
        paperSetterName: exam.teacher?.userName ?? "",
        ...counts,
        assignment: assignment
          ? {
              assignmentId: assignment.assignmentId,
              teacherId: assignment.teacherId,
              teacherName: evaluator?.userName ?? "",
              teacherEmail: evaluator?.emailId ?? "",
              note: assignment.note,
              assignedAt: assignment.createdAt,
            }
          : null,
      };
    })
  );

  const filtered = search
    ? rows.filter((r) =>
        [r.subjectName, r.className, r.examType, r.sessionName, r.assignment?.teacherName, r.paperSetterName]
          .join(" ")
          .toLowerCase()
          .includes(search)
      )
    : rows;

  return {
    exams: filtered,
    summary: {
      total: filtered.length,
      assigned: filtered.filter((r) => r.assignment).length,
      unassigned: filtered.filter((r) => !r.assignment).length,
    },
  };
};

async function findReadyExam(instituteId: string, examId: string) {
  const exam: any = await Exam.findOne({ where: { examId, instituteId, isDeleted: false }, include: EXAM_INCLUDES });
  if (!exam) throw new ApiError(httpStatus.NOT_FOUND, "Exam not found.");
  if (!EVALUATION_READY_STATUSES.includes(exam.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Evaluation can be assigned only after the exam's question paper is approved.");
  }
  return exam;
}

// ── Admin: teachers of the exam's subject (any class) ────────────────────────

const listEligibleTeachers = async (admin: any, examId: string) => {
  const instituteId = admin.instituteId;
  const exam = await findReadyExam(instituteId, examId);
  const subjectName = clean(exam.subject?.subjectName);

  const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });
  const [teachers, sameSubjects, activeCounts, classSubjects] = await Promise.all([
    UserModal.findAll({
      where: { instituteId, roleId: teacherRole?.id, status: 1 },
      attributes: ["userId", "userName", "emailId"],
      include: [{ model: TeacherProfile, as: "teacherProfile", attributes: ["specialization"], required: false }],
      order: [["userName", "ASC"]],
    }),
    Subject.findAll({
      where: { instituteId, isDeleted: false, subjectName: { [Op.iLike]: subjectName.replace(/[\\%_]/g, (ch) => `\\${ch}`) }, teacherId: { [Op.ne]: null } },
      attributes: ["subjectId", "teacherId", "classId"],
      include: [{ model: Class, as: "class", attributes: ["className"], required: false }],
    }),
    EvaluationAssignment.findAll({
      where: { instituteId, isActive: true },
      attributes: ["teacherId", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      group: ["teacherId"],
      raw: true,
    }) as unknown as Promise<{ teacherId: string; count: string }[]>,
    // Anyone teaching this class (any subject) already knows its students.
    Subject.findAll({
      where: { instituteId, classId: exam.classId, isDeleted: false, teacherId: { [Op.ne]: null } },
      attributes: ["teacherId", "subjectName"],
    }),
  ]);
  const classSubjectsByTeacher = new Map<string, string[]>();
  classSubjects.forEach((s: any) => {
    const list = classSubjectsByTeacher.get(s.teacherId) ?? [];
    if (!list.includes(s.subjectName)) list.push(s.subjectName);
    classSubjectsByTeacher.set(s.teacherId, list);
  });

  const classesByTeacher = new Map<string, string[]>();
  sameSubjects.forEach((s: any) => {
    const list = classesByTeacher.get(s.teacherId) ?? [];
    if (s.class?.className && !list.includes(s.class.className)) list.push(s.class.className);
    classesByTeacher.set(s.teacherId, list);
  });
  const loadByTeacher = new Map(activeCounts.map((r) => [r.teacherId, Number(r.count) || 0]));
  const current = await EvaluationAssignment.findOne({ where: { examId, isActive: true } });

  const eligible = teachers
    .filter((t: any) => classesByTeacher.has(t.userId) || specialisesIn(t.teacherProfile?.specialization, subjectName))
    .map((t: any) => ({
      userId: t.userId,
      userName: t.userName,
      emailId: t.emailId,
      subjectClasses: (classesByTeacher.get(t.userId) ?? []).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      teachesThisClass: Boolean(exam.subject) && sameSubjects.some((s: any) => s.subjectId === exam.subjectId && s.teacherId === t.userId),
      /** Subjects this teacher teaches in the exam's class — they know these students. */
      classSubjects: classSubjectsByTeacher.get(t.userId) ?? [],
      isPaperSetter: exam.teacherId === t.userId,
      activeAssignments: loadByTeacher.get(t.userId) ?? 0,
      isCurrentEvaluator: current?.teacherId === t.userId,
    }))
    .sort(
      (a, b) =>
        Number(a.teachesThisClass) - Number(b.teachesThisClass) ||
        Number(a.classSubjects.length > 0) - Number(b.classSubjects.length > 0) ||
        Number(a.isPaperSetter) - Number(b.isPaperSetter) ||
        a.activeAssignments - b.activeAssignments ||
        a.userName.localeCompare(b.userName)
    );

  return {
    exam: {
      examId: exam.examId,
      examType: exam.examType,
      className: exam.class?.className ?? "",
      subjectName,
      sessionName: exam.session?.sessionName ?? "",
    },
    teachers: eligible,
  };
};

// ── Admin: assign / unassign ─────────────────────────────────────────────────

const assign = async (admin: any, body: any) => {
  const instituteId = admin.instituteId;
  const examId = clean(body?.examId);
  const teacherId = clean(body?.teacherId);
  const note = clean(body?.note).slice(0, 500) || null;
  if (!examId || !teacherId) throw new ApiError(httpStatus.BAD_REQUEST, "examId and teacherId are required.");

  const { exam, teachers } = await listEligibleTeachers(admin, examId);
  const teacher = teachers.find((t) => t.userId === teacherId);
  if (!teacher) {
    throw new ApiError(httpStatus.BAD_REQUEST, `This teacher does not teach ${exam.subjectName}. Pick one of the ${exam.subjectName} teachers.`);
  }

  const transaction = await sequelize.transaction();
  let previousTeacherId: string | null = null;
  let created: EvaluationAssignment;
  try {
    const previous = await EvaluationAssignment.findOne({ where: { examId, isActive: true }, transaction, lock: true });
    if (previous?.teacherId === teacherId) {
      await previous.update({ note, assignedBy: admin.userId }, { transaction });
      await transaction.commit();
      return previous;
    }
    if (previous) {
      previousTeacherId = previous.teacherId;
      await previous.update({ isActive: false, unassignedAt: new Date() }, { transaction });
    }
    created = await EvaluationAssignment.create(
      { assignmentId: await RegHelper.generateUserId(), instituteId, examId, teacherId, assignedBy: admin.userId, note },
      { transaction }
    );
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  const label = `${exam.subjectName} · ${exam.examType} · Class ${exam.className}`;
  await notify(instituteId, teacherId, "EVALUATION_ASSIGNED", "Answer sheets assigned for evaluation",
    `You have been assigned to evaluate ${label}. Student identities are hidden.`, examId);
  if (previousTeacherId) {
    await notify(instituteId, previousTeacherId, "EVALUATION_UNASSIGNED", "Evaluation reassigned",
      `Evaluation of ${label} has been assigned to another teacher.`, examId);
  }
  return created;
};

const unassign = async (admin: any, examId: string) => {
  const instituteId = admin.instituteId;
  const active: any = await EvaluationAssignment.findOne({ where: { instituteId, examId, isActive: true } });
  if (!active) throw new ApiError(httpStatus.NOT_FOUND, "No evaluator is assigned to this exam.");
  await active.update({ isActive: false, unassignedAt: new Date() });

  const exam: any = await Exam.findOne({ where: { examId }, include: EXAM_INCLUDES });
  if (exam) {
    await notify(instituteId, active.teacherId, "EVALUATION_UNASSIGNED", "Evaluation unassigned",
      `You are no longer assigned to evaluate ${examLabel(exam)}.`, examId);
  }
  return { examId };
};

// ── Evaluation pages: exams whose sheets the requester may open ──────────────

const myExams = async (user: any) => {
  const instituteId = user.instituteId;
  const where: any = { instituteId, isDeleted: false };
  const assignedIds = new Set<string>();
  const scope = isTeacherRequester(user) ? await getTeacherScope(user) : null;

  if (scope) {
    scope.assignedExams.forEach((a) => assignedIds.add(a.examId));
    const or: any[] = [];
    if (scope.ownSubjectIds.size) or.push({ subjectId: { [Op.in]: Array.from(scope.ownSubjectIds) } });
    if (assignedIds.size) or.push({ examId: { [Op.in]: Array.from(assignedIds) } });
    // A teacher who only set the question paper has nothing to evaluate here.
    if (!or.length) return { exams: [] };
    where[Op.or] = or;
  }

  const exams: any[] = await Exam.findAll({ where, include: EXAM_INCLUDES, order: [["createdAt", "DESC"]] });
  const activeAssignments = exams.length
    ? await EvaluationAssignment.findAll({ where: { isActive: true, examId: { [Op.in]: exams.map((e) => e.examId) } }, attributes: ["examId"] })
    : [];
  const assignedExamIds = new Set(activeAssignments.map((a) => a.examId));

  const rows = await Promise.all(
    exams.map(async (exam) => {
      const className = exam.class?.className || exam.classId;
      const sectionName = exam.section?.sectionName || "";
      const sessionName = exam.session?.sessionName || "";
      const studentRes: any = await StudentService.getAllStudents(user, { className, sectionId: sectionName, session: sessionName }).catch(() => null);
      const students: any[] = Array.isArray(studentRes?.data?.students) ? studentRes.data.students : [];
      const sheets = await Scanner.findAll({ where: sheetWhereForExam(exam, instituteId), attributes: ["sheetId", "rollNo"] });
      const rolls = new Set(students.map((s) => clean(s.rollNumber)));
      const orphans = sheets.filter((s) => !rolls.has(clean(s.rollNo))).length;
      const counts = await sheetCounts(exam, instituteId);
      const access: SheetAccess = scope ? accessForSheet(scope, { subjectId: exam.subjectId, examId: exam.examId }) : "full";

      return {
        id: exam.examId,
        examId: exam.examId,
        classId: exam.class?.classId || exam.classId,
        className: exam.class?.className || "N/A",
        sectionId: exam.section?.sectionId || exam.sectionId || null,
        sectionName: sectionName || "N/A",
        subjectId: exam.subjectId,
        subjectName: exam.subject?.subjectName || "N/A",
        sessionId: exam.session?.sessionId || exam.sessionId,
        sessionName: sessionName || "N/A",
        examType: exam.examType,
        status: exam.status,
        totalMarks: exam.totalMarks,
        totalStudents: students.length + orphans,
        ...counts,
        access,
        role: !scope ? "admin" : isAssignedEvaluator(scope, { subjectId: exam.subjectId, examId: exam.examId }) ? "evaluator" : "subjectTeacher",
        /** Only the assigned evaluator (or an admin) may run AI evaluation. */
        canEvaluate: !scope || isAssignedEvaluator(scope, { subjectId: exam.subjectId, examId: exam.examId }),
        hasEvaluator: assignedExamIds.has(exam.examId),
        identityMasked: access === "masked",
        createdAt: exam.createdAt,
      };
    })
  );

  return { exams: rows.filter((r) => r.access !== "none") };
};

/** Section-wise progress of one exam, for users who may open its sheets. */
const examProgressAccess = async (user: any, examId: string) => {
  if (!isTeacherRequester(user)) return;
  const exam: any = await Exam.findOne({ where: { examId, isDeleted: false }, attributes: ["examId", "subjectId"] });
  if (!exam) return;
  const access = accessForSheet(await getTeacherScope(user), { subjectId: exam.subjectId, examId: exam.examId });
  if (access === "none") throw new ApiError(httpStatus.FORBIDDEN, "This exam is not assigned to you for evaluation.");
};

// ── Roster: students + their uploaded sheets, masked for evaluators ──────────

const EVAL_STATUS: Record<string, string> = { Success: "Evaluated", Pending: "Evaluating", Failed: "Failed" };

const getRoster = async (user: any, query: any) => {
  const instituteId = user.instituteId;
  const className = clean(query?.className);
  const section = clean(query?.section);
  const session = clean(query?.session);
  const examType = clean(query?.examType);
  const requestedClassId = clean(query?.classId);
  const requestedSubjectId = clean(query?.subjectId);
  const subjectName = clean(query?.subjectName);
  let examId = clean(query?.examId);

  if (!className || !examType) throw new ApiError(httpStatus.BAD_REQUEST, "className and examType are required.");

  // Ids sent by the browser are never trusted on their own: the class, subject and exam
  // must all belong together, otherwise an id from one exam could open another class.
  const cls = await Class.findOne({ where: { instituteId, className, isDeleted: false }, attributes: ["classId"] });
  const classId = cls?.classId ?? requestedClassId;
  if (!classId) throw new ApiError(httpStatus.BAD_REQUEST, "Class not found.");

  const sub = await Subject.findOne({
    where: {
      instituteId,
      classId,
      isDeleted: false,
      ...(requestedSubjectId ? { subjectId: requestedSubjectId } : { subjectName }),
    },
    attributes: ["subjectId"],
  });
  const subjectId = sub?.subjectId ?? "";
  if (!subjectId) throw new ApiError(httpStatus.BAD_REQUEST, "Subject not found for this class.");

  if (examId) {
    const exam = await Exam.findOne({ where: { examId, instituteId, subjectId, examType, isDeleted: false }, attributes: ["examId"] });
    if (!exam) examId = "";
  }

  let access: SheetAccess = "full";
  let canEvaluate = true;
  if (isTeacherRequester(user)) {
    const scope = await getTeacherScope(user);
    canEvaluate =
      isAssignedEvaluator(scope, { subjectId, classId, examType, examId }) ||
      isAssignedEvaluator(scope, { subjectId, classId: className, examType, examId });
    access = accessForSheet(scope, { subjectId, classId, examType, examId });
    if (access === "none" && className) access = accessForSheet(scope, { subjectId, classId: className, examType, examId });
    if (access === "none") {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "These answer sheets are not assigned to you. Only the class subject teacher or the evaluator assigned by the admin can open them."
      );
    }
  }

  const studentRes: any = await StudentService.getAllStudents(user, { className, sectionId: section, session });
  const students: any[] = Array.isArray(studentRes?.data?.students) ? studentRes.data.students : [];

  const sheetWhere: any = {
    instituteId,
    subjectId,
    examType,
    isDeleted: false,
    classId: { [Op.in]: [classId, className].filter(Boolean) },
  };
  if (section) sheetWhere.section = section;
  const sheets: any[] = await Scanner.findAll({
    where: sheetWhere,
    attributes: { exclude: ["fileBuffer"] },
    order: [["createdAt", "DESC"]],
  });
  const evals = sheets.length
    ? await AIEvaluation.findAll({
        where: { sheetId: { [Op.in]: sheets.map((s) => s.sheetId) } },
        attributes: ["sheetId", "status", "totalScore"],
      })
    : [];
  const evalBySheet = new Map(evals.map((e) => [e.sheetId, e]));

  const sheetByRoll = new Map<string, any>();
  sheets.forEach((s) => {
    const key = clean(s.rollNo);
    if (key && !sheetByRoll.has(key)) sheetByRoll.set(key, s); // newest upload wins
  });

  const masked = access === "masked";
  const toRow = (student: any | null, sheet: any | null, index: number) => {
    const ev = sheet ? evalBySheet.get(sheet.sheetId) : null;
    const name = student?.userName || sheet?.studentName || "Unknown student";
    const roll = clean(student?.rollNumber ?? sheet?.rollNo);
    const ext = String(sheet?.fileName ?? "").match(/\.[a-z0-9]{1,6}$/i)?.[0]?.toLowerCase() ?? "";
    return {
      rowKey: sheet?.sheetId ?? `no-sheet-${index}`,
      studentId: masked ? maskId(student?.userId) : student?.userId ?? null,
      name: masked ? maskName(name) : name,
      roll: masked ? maskRoll(roll) : roll,
      className: student?.className || className,
      section: section || student?.sectionName || sheet?.section || "",
      sheetId: sheet?.sheetId ?? null,
      fileName: sheet ? (masked ? `answer-sheet${ext}` : sheet.fileName) : null,
      uploadedAt: sheet?.createdAt ?? null,
      sheetStatus: sheet ? (ev ? EVAL_STATUS[ev.status] ?? sheet.status : sheet.status) : "Missing",
      aiScore: ev?.status === "Success" ? ev.totalScore : null,
      evaluationStatus: ev?.status ?? null,
      identityMasked: masked,
    };
  };

  const rows = students.map((st, i) => toRow(st, sheetByRoll.get(clean(st.rollNumber)) ?? null, i));
  const knownRolls = new Set(students.map((st) => clean(st.rollNumber)));
  sheets
    .filter((sh) => !knownRolls.has(clean(sh.rollNo)))
    .forEach((sh, i) => rows.push(toRow(null, sh, students.length + i)));

  // Masked lists must not reveal the class order (roll / alphabetical) either.
  if (masked) rows.sort((a, b) => String(a.rowKey).localeCompare(String(b.rowKey)));

  return {
    access,
    canEvaluate,
    rows,
    summary: {
      total: rows.length,
      uploaded: rows.filter((r) => r.sheetId).length,
      missing: rows.filter((r) => !r.sheetId).length,
      evaluated: rows.filter((r) => r.evaluationStatus === "Success").length,
    },
  };
};

export default {
  listExams,
  listEligibleTeachers,
  assign,
  unassign,
  getRoster,
  sheetCounts,
  myExams,
  examProgressAccess,
};
