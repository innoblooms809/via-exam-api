// Evaluation assignment: after an exam's paper is approved the admin picks a teacher
// of that subject (any class) to evaluate its uploaded answer sheets.
// The roster used by the evaluation pages is built here too, so names are masked
// on the server for assigned evaluators (see evaluationAccess.service.ts).

import httpStatus from "http-status";
import { Op } from "sequelize";
import { sequelize } from "../../config/sequelize";
import Exam from "../../models/Exam.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Subject from "../../models/Subject.model";
import Session from "../../models/Session.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import Scanner from "../../models/Scanner.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import Notification from "../../models/Notification.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import StudentService from "../student/student.service";
import ApiError from "../../utils/ApiError";
import { refreshExamStatus } from "../exam/exam.service";
import { activeEvaluators, assertReadyForReview, pickSections, reviewState } from "../exam/examWorkflow.service";
import { buildRoster, loadExam, sectionKey, sectionsOfExam } from "../exam/examRoster.service";
import SessionSection from "../../models/SessionSection.model";
import StudentResult from "../../models/StudentResult.model";
import { examLabel, instituteAdminIds, notifyAll, workLabel } from "../notification/notifyPeople";
import { closeRoundForReopen } from "../exam/crossCheck.service";

/** Runs `fn` over `items`, `limit` at a time (each exam's roster is a few queries). */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
};

/** Once results are out the evaluator can't change; unpublish first. */
async function assertNotPublished(examId: string) {
  const published = await StudentResult.count({ where: { examId, isDeleted: false } });
  if (published) {
    throw new ApiError(httpStatus.CONFLICT, "Results of this exam are already published. Unpublish them before changing the evaluator.");
  }
}
import { specialisesIn } from "../../utils/specialization";
import { newId } from "../../utils/idGenerator";
import {
  accessForSheet,
  assignedSectionsOf,
  getTeacherScope,
  isAssignedEvaluator,
  isTeacherRequester,
  maskId,
  maskName,
  maskRoll,
  type SheetAccess,
} from "./evaluationAccess.service";
import { scanQualityView } from "../answer-sheet/sheetQuality.service";

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
      notificationId: newId("notification"),
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


// ── Admin: approved exams with their evaluator ───────────────────────────────

const listExams = async (admin: any, query: any) => {
  const instituteId = admin.instituteId;
  const search = clean(query?.search).toLowerCase();

  // 1. Exams whose parent status is already synced to Approved/Live/Completed
  const exams: any[] = await Exam.findAll({
    where: { instituteId, isDeleted: false, status: { [Op.in]: EVALUATION_READY_STATUSES } },
    include: EXAM_INCLUDES,
    order: [["updatedAt", "DESC"]],
  });

  // 2. Also find exams that have approved paper sets but parent status wasn't synced
  const existingIds = new Set(exams.map((e: any) => e.examId));
  const approvedPapers: any[] = await QuestionPaper.findAll({
    where: { instituteId, status: { [Op.in]: ["APPROVED", "PUBLISHED"] } },
    attributes: ["examId"],
    group: ["examId"],
  });
  const missingIds = approvedPapers.map((p: any) => p.examId).filter((id: string) => !existingIds.has(id));

  if (missingIds.length) {
    const extraExams: any[] = await Exam.findAll({
      where: { examId: { [Op.in]: missingIds }, instituteId, isDeleted: false },
      include: EXAM_INCLUDES,
    });
    // Auto-fix their parent status so future queries work without this fallback
    for (const ex of extraExams) {
      try { await refreshExamStatus(ex.examId); } catch (_) { /* non-blocking */ }
    }
    exams.push(...extraExams);
  }

  const active = exams.length
    ? await EvaluationAssignment.findAll({
        where: { instituteId, isActive: true, examId: { [Op.in]: exams.map((e) => e.examId) } },
        order: [["createdAt", "ASC"]],
      })
    : [];
  const evaluatorIds = Array.from(new Set(active.map((a) => a.teacherId)));
  const evaluators = evaluatorIds.length
    ? await UserModal.findAll({ where: { userId: { [Op.in]: evaluatorIds } }, attributes: ["userId", "userName", "emailId"] })
    : [];
  const evaluatorById = new Map(evaluators.map((u) => [u.userId, u]));
  const assignmentView = (a: EvaluationAssignment) => ({
    assignmentId: a.assignmentId,
    teacherId: a.teacherId,
    teacherName: evaluatorById.get(a.teacherId)?.userName ?? "",
    teacherEmail: evaluatorById.get(a.teacherId)?.emailId ?? "",
    note: a.note,
    assignedAt: a.createdAt,
    reviewedAt: a.reviewedAt,
    reviewedBy: a.reviewedBy,
  });

  const rows = await mapLimit(exams, 6, async (exam: any) => {
    const roster = await buildRoster(exam);
    const mine = active.filter((a) => a.examId === exam.examId);
    // Section by section: its evaluator and how far its sheets have got.
    const sections = roster.sections.map((s) => {
      const a = mine.find((x) => sectionKey(x.sectionId) === sectionKey(s.sectionId));
      return {
        sectionId: s.sectionId,
        sectionName: s.sectionName,
        totalStudents: s.counts.total,
        uploadedSheets: s.counts.uploaded,
        evaluatedSheets: s.counts.evaluated,
        failedSheets: s.counts.evaluationFailed,
        assignment: a ? assignmentView(a) : null,
      };
    });
    const allReviewed = sections.length > 0 && sections.every((s) => s.assignment?.reviewedAt);
    return {
      examId: exam.examId,
      examType: exam.examType,
      status: exam.status,
      examDate: exam.examDate,
      classId: exam.classId,
      className: exam.class?.className ?? "",
      sectionName: exam.section?.sectionName ?? "",
      wholeClass: !exam.sectionId,
      subjectId: exam.subjectId,
      subjectName: exam.subject?.subjectName ?? "",
      sessionName: exam.session?.sessionName ?? "",
      paperSetterId: exam.teacherId,
      paperSetterName: exam.teacher?.userName ?? "",
      uploadedSheets: roster.counts.uploaded,
      evaluatedSheets: roster.counts.evaluated,
      failedSheets: roster.counts.evaluationFailed,
      sections,
      /** Every section has an evaluator. */
      fullyAssigned: sections.length > 0 && sections.every((s) => s.assignment),
      // The whole exam at a glance: everyone on it, reviewed only when every section is.
      assignment: mine.length
        ? {
            ...assignmentView(mine[0]),
            teacherName: [...new Set(mine.map((a) => evaluatorById.get(a.teacherId)?.userName ?? ""))].filter(Boolean).join(", "),
            reviewedAt: allReviewed ? new Date(Math.max(...mine.map((a) => new Date(a.reviewedAt as Date).getTime()))) : null,
          }
        : null,
    };
  });

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
      assigned: filtered.filter((r) => r.fullyAssigned).length,
      unassigned: filtered.filter((r) => !r.fullyAssigned).length,
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
      attributes: ["teacherId", "subjectName", "sectionId"],
    }),
  ]);
  const classSubjectsByTeacher = new Map<string, string[]>();
  // The sections each teacher already teaches ("*": a subject of the whole class, so every section).
  const knowsSections = new Map<string, Set<string>>();
  const knows = (teacherId: string, key: string) => knowsSections.set(teacherId, new Set([...(knowsSections.get(teacherId) ?? []), key]));
  classSubjects.forEach((s: any) => {
    const list = classSubjectsByTeacher.get(s.teacherId) ?? [];
    if (!list.includes(s.subjectName)) list.push(s.subjectName);
    classSubjectsByTeacher.set(s.teacherId, list);
    knows(s.teacherId, s.sectionId || "*");
  });
  const [sections, classTeachers] = await Promise.all([
    sectionsOfExam(exam),
    exam.classId ? SessionSection.findAll({ where: { sessionId: exam.sessionId, classId: exam.classId, classTeacherId: { [Op.ne]: null } }, attributes: ["sectionId", "classTeacherId"] }) : [],
  ]);
  classTeachers.forEach((c: any) => knows(c.classTeacherId, c.sectionId));

  const classesByTeacher = new Map<string, string[]>();
  sameSubjects.forEach((s: any) => {
    const list = classesByTeacher.get(s.teacherId) ?? [];
    if (s.class?.className && !list.includes(s.class.className)) list.push(s.class.className);
    classesByTeacher.set(s.teacherId, list);
  });
  const loadByTeacher = new Map(activeCounts.map((r) => [r.teacherId, Number(r.count) || 0]));
  const current = await EvaluationAssignment.findAll({ where: { examId, isActive: true } });
  const currentBySection = new Map(current.map((c) => [sectionKey(c.sectionId), c]));
  const teacherName = new Map((teachers as any[]).map((t) => [t.userId, t.userName]));

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
      /** Sections of the class they teach or are class teacher of ("*": all of them); blind marking prefers others. */
      knowsSections: [...(knowsSections.get(t.userId) ?? [])],
      isPaperSetter: exam.teacherId === t.userId,
      activeAssignments: loadByTeacher.get(t.userId) ?? 0,
      isCurrentEvaluator: current.some((c) => c.teacherId === t.userId),
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
      sectionName: exam.section?.sectionName ?? "",
      wholeClass: !exam.sectionId,
      subjectName,
      sessionName: exam.session?.sessionName ?? "",
    },
    // Each section of the exam and who evaluates it now.
    sections: sections.map((s) => {
      const c = currentBySection.get(sectionKey(s.sectionId));
      return {
        sectionId: s.sectionId,
        sectionName: s.sectionName,
        students: s.students,
        evaluator: c ? { teacherId: c.teacherId, name: teacherName.get(c.teacherId) ?? "", reviewedAt: c.reviewedAt } : null,
      };
    }),
    teachers: eligible,
  };
};

// ── Admin: assign / unassign ─────────────────────────────────────────────────

/**
 * Gives the evaluation of some sections of the exam (`sectionIds`; all of them when it names
 * none) to a teacher. A section another teacher had moves over; its review starts afresh.
 */
const assign = async (admin: any, body: any) => {
  const instituteId = admin.instituteId;
  const examId = clean(body?.examId);
  const teacherId = clean(body?.teacherId);
  const note = clean(body?.note).slice(0, 500) || null;
  if (!examId || !teacherId) throw new ApiError(httpStatus.BAD_REQUEST, "examId and teacherId are required.");

  const { exam, sections, teachers } = await listEligibleTeachers(admin, examId);
  await assertNotPublished(examId);
  const teacher = teachers.find((t) => t.userId === teacherId);
  if (!teacher) {
    throw new ApiError(httpStatus.BAD_REQUEST, `This teacher does not teach ${exam.subjectName}. Pick one of the ${exam.subjectName} teachers.`);
  }
  const wanted = pickSections(sections.map((s) => ({ sectionId: s.sectionId, sectionName: s.sectionName, students: s.students })), body?.sectionIds);

  const given: string[] = [];
  const movedFrom = new Map<string, string[]>();
  const rows = await sequelize.transaction(async (transaction) => {
    const out: EvaluationAssignment[] = [];
    for (const section of wanted) {
      const previous = await EvaluationAssignment.findOne({ where: { examId, sectionId: section.sectionId, isActive: true }, transaction, lock: true });
      if (previous?.teacherId === teacherId) {
        await previous.update({ note, assignedBy: admin.userId }, { transaction });
        out.push(previous);
        continue;
      }
      if (previous) {
        movedFrom.set(previous.teacherId, [...(movedFrom.get(previous.teacherId) ?? []), section.sectionName]);
        await previous.update({ isActive: false, unassignedAt: new Date() }, { transaction });
      }
      out.push(
        await EvaluationAssignment.create(
          { assignmentId: newId("assignment"), instituteId, examId, sectionId: section.sectionId, teacherId, assignedBy: admin.userId, note },
          { transaction }
        )
      );
      given.push(section.sectionName);
    }
    return out;
  });

  const examRow = await loadExam(instituteId, examId);
  if (given.length) {
    await notify(instituteId, teacherId, "EVALUATION_ASSIGNED", "Answer sheets assigned for evaluation",
      `You have been assigned to evaluate ${workLabel(examRow, given)}. Student identities are hidden.`, examId);
  }
  for (const [previousTeacherId, names] of movedFrom) {
    await notify(instituteId, previousTeacherId, "EVALUATION_UNASSIGNED", "Evaluation reassigned",
      `Evaluation of ${workLabel(examRow, names)} has been assigned to another teacher.`, examId);
  }
  return {
    examId,
    teacherId,
    assignmentId: rows[0]?.assignmentId ?? null,
    sections: rows.map((r) => ({ sectionId: r.sectionId, assignmentId: r.assignmentId, assignedAt: r.createdAt })),
  };
};

/** Takes the evaluator off one section (`?sectionId=`, "" = students without a section) or, without it, off every section. */
const unassign = async (admin: any, examId: string, query: any = {}) => {
  const instituteId = admin.instituteId;
  const only = query && Object.prototype.hasOwnProperty.call(query, "sectionId") ? sectionKey(query.sectionId) : null;
  const active = (await EvaluationAssignment.findAll({ where: { instituteId, examId, isActive: true } })).filter(
    (a) => only === null || sectionKey(a.sectionId) === only
  );
  if (!active.length) throw new ApiError(httpStatus.NOT_FOUND, only === null ? "No evaluator is assigned to this exam." : "No evaluator is assigned to that section.");
  await assertNotPublished(examId);
  for (const a of active) await a.update({ isActive: false, unassignedAt: new Date() });

  const exam: any = await Exam.findOne({ where: { examId }, include: EXAM_INCLUDES });
  if (exam) {
    const nameOf = new Map((await sectionsOfExam(exam)).map((s) => [sectionKey(s.sectionId), s.sectionName]));
    const byTeacher = new Map<string, string[]>();
    for (const a of active) byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) ?? []), nameOf.get(sectionKey(a.sectionId)) ?? ""]);
    for (const [teacherId, names] of byTeacher) {
      await notify(instituteId, teacherId, "EVALUATION_UNASSIGNED", "Evaluation unassigned",
        `You are no longer assigned to evaluate ${workLabel(exam, names)}.`, examId);
    }
  }
  return { examId, removed: active.length };
};

// ── Evaluation pages: exams whose sheets the requester may open ──────────────

const myExams = async (user: any, query?: any) => {
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
    if (!or.length) return { exams: [], pagination: { total: 0, page: 1, limit: 10, totalPages: 0 } };
    where[Op.or] = or;
  }

  // Order by createdAt DESC so most recently created exams are at the top
  const exams: any[] = await Exam.findAll({ where, include: EXAM_INCLUDES, order: [["createdAt", "DESC"]] });
  const activeAssignments = exams.length
    ? await EvaluationAssignment.findAll({
        where: { isActive: true, examId: { [Op.in]: exams.map((e) => e.examId) } },
        attributes: ["examId", "sectionId", "teacherId", "reviewedAt", "reviewedBy"],
      })
    : [];
  const nested = await mapLimit(exams, 6, async (exam: any) => {
    const roster = await buildRoster(exam);
    const access: SheetAccess = scope ? accessForSheet(scope, { subjectId: exam.subjectId, examId: exam.examId }) : "full";
    const isAssigned = scope ? isAssignedEvaluator(scope, { subjectId: exam.subjectId, examId: exam.examId }) : false;
    const mine = activeAssignments.filter((a) => a.examId === exam.examId);
    const assignmentOf = (sectionId: string | null) => mine.find((a) => sectionKey(a.sectionId) === sectionKey(sectionId));
    const sessionName = exam.session?.sessionName || "";

    const rowFor = (section: (typeof roster.sections)[number] | null) => {
      const counts = section ? section.counts : roster.counts;
      // One section: its evaluator's review. The whole exam: every section reviewed.
      const reviews = section ? [assignmentOf(section.sectionId)] : roster.sections.map((s) => assignmentOf(s.sectionId));
      const reviewed = reviews.length > 0 && reviews.every((a) => a?.reviewedAt);
      const last = reviewed ? reviews.reduce((x, a) => (!x || new Date(a!.reviewedAt as Date) > new Date(x.reviewedAt as Date) ? a! : x), undefined as EvaluationAssignment | undefined) : undefined;
      const sectionName = section ? section.sectionName : exam.section?.sectionName || "";
      return {
        id: section ? `${exam.examId}:${sectionKey(section.sectionId)}` : exam.examId,
        examId: exam.examId,
        classId: exam.class?.classId || exam.classId,
        className: exam.class?.className || "N/A",
        sectionId: section ? section.sectionId : exam.section?.sectionId || exam.sectionId || null,
        sectionName: sectionName || "N/A",
        wholeClass: !exam.sectionId,
        subjectId: exam.subjectId,
        subjectName: exam.subject?.subjectName || "N/A",
        sessionId: exam.session?.sessionId || exam.sessionId,
        sessionName: sessionName || "N/A",
        examType: exam.examType,
        status: exam.status,
        totalMarks: exam.totalMarks,
        totalStudents: counts.total,
        uploadedSheets: counts.uploaded,
        evaluatedSheets: counts.evaluated,
        failedSheets: counts.evaluationFailed,
        access,
        role: !scope ? "admin" : isAssigned ? "evaluator" : "subjectTeacher",
        /** Only the assigned evaluator (or an admin) may run AI evaluation. */
        canEvaluate: !scope || isAssigned,
        hasEvaluator: section ? Boolean(assignmentOf(section.sectionId)) : mine.length > 0,
        isReviewed: reviewed,
        reviewedAt: last?.reviewedAt ?? null,
        reviewedBy: last?.reviewedBy ?? null,
        identityMasked: access === "masked",
        createdAt: exam.createdAt,
      };
    };

    // An evaluator given sections of a whole-class exam works section by section: a row each.
    const mySections = scope ? assignedSectionsOf(scope, exam.examId) : null;
    if (mySections && !exam.sectionId && roster.sections.length > 1) {
      return roster.sections.filter((s) => mySections.has(sectionKey(s.sectionId))).map(rowFor);
    }
    return [rowFor(null)];
  });
  const rows = nested.flat();

  let filtered = rows.filter((r) => r.access !== "none");

  // Strict sorting by createdAt DESC so most recently created is at the top
  filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Search filter if provided
  const search = clean(query?.search).toLowerCase();
  if (search) {
    filtered = filtered.filter((r) =>
      [r.subjectName, r.className, r.examType, r.sessionName].join(" ").toLowerCase().includes(search)
    );
  }

  const total = filtered.length;
  const page = Math.max(1, parseInt(query?.page as string, 10) || 1);
  const limit = Math.max(1, parseInt(query?.limit as string, 10) || 10);
  const totalPages = Math.ceil(total / limit);

  // If query specifies pagination (or by default):
  const startIndex = (page - 1) * limit;
  const paginatedExams = filtered.slice(startIndex, startIndex + limit);

  return {
    exams: paginatedExams,
    pagination: {
      total,
      page,
      limit,
      totalPages,
    },
  };
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

  // The exam these sheets belong to: the one named, else the newest of this class / subject / type
  // (in the session named) that covers the section.
  const sectionRow = section
    ? await Section.findOne({ where: { classId, isDeleted: false, [Op.or]: [{ sectionId: section }, { sectionName: section }] }, attributes: ["sectionId", "sectionName"] })
    : null;
  if (examId) {
    const exam = await Exam.findOne({ where: { examId, instituteId, subjectId, examType, isDeleted: false }, attributes: ["examId"] });
    if (!exam) examId = "";
  }
  if (!examId) {
    const sessionRow = session ? await Session.findOne({ where: { instituteId, sessionName: session }, attributes: ["sessionId"] }) : null;
    const candidates = await Exam.findAll({
      where: { instituteId, classId, subjectId, examType, isDeleted: false, ...(sessionRow ? { sessionId: sessionRow.sessionId } : {}) },
      attributes: ["examId", "sectionId"],
      order: [["createdAt", "DESC"]],
    });
    examId = candidates.find((e) => !e.sectionId || e.sectionId === sectionRow?.sectionId)?.examId ?? "";
  }
  const exam: any = examId ? await loadExam(instituteId, examId) : null;
  // The section asked for, as one of the exam's ("" = students without a section); null = all of them.
  let wanted: string | null = null;
  if (exam && section && !exam.sectionId) {
    const match = (await sectionsOfExam(exam)).find((s) => (sectionRow && s.sectionId === sectionRow.sectionId) || s.sectionName.toLowerCase() === section.toLowerCase());
    wanted = match ? sectionKey(match.sectionId) : null;
  }

  let access: SheetAccess = "full";
  let canEvaluate = true;
  let only: string[] | null = wanted !== null ? [wanted] : null;
  if (isTeacherRequester(user)) {
    const scope = await getTeacherScope(user);
    const at = (classKey: string) => ({ subjectId, classId: classKey, examType, examId, ...(wanted !== null ? { sectionId: wanted || null } : {}) });
    canEvaluate = isAssignedEvaluator(scope, at(classId)) || isAssignedEvaluator(scope, at(className));
    access = accessForSheet(scope, at(classId));
    if (access === "none" && className) access = accessForSheet(scope, at(className));
    if (access === "none") {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "These answer sheets are not assigned to you. Only the class subject teacher or the evaluator assigned by the admin can open them."
      );
    }
    // An evaluator who doesn't teach the subject sees only the sections given to them.
    const mySections = examId ? assignedSectionsOf(scope, examId) : null;
    if (mySections && !scope.ownSubjectIds.has(subjectId)) only = only ? only.filter((k) => mySections.has(k)) : [...mySections];
  }

  if (exam) {
    const roster = await buildRoster(exam, { sections: only });
    const masked = access === "masked";
    const rows = roster.rows.map((r, i) => {
      const name = r.name || "Unknown student";
      const ext = String(r.fileName ?? "").match(/\.[a-z0-9]{1,6}$/i)?.[0]?.toLowerCase() ?? "";
      return {
        rowKey: r.sheetId ?? `no-sheet-${i}`,
        studentId: masked ? maskId(r.studentId) : r.studentId,
        name: masked ? maskName(name) : name,
        roll: masked ? maskRoll(r.rollNo) : r.rollNo,
        className,
        section: r.sectionName || section || "",
        sheetId: r.sheetId,
        fileName: r.fileName ? (masked ? `answer-sheet${ext}` : r.fileName) : null,
        uploadedAt: r.uploadedAt,
        sheetStatus: r.sheetId ? (r.evaluationStatus ? EVAL_STATUS[r.evaluationStatus] : null) ?? r.sheetStatus ?? "Pending" : "Missing",
        aiScore: r.score,
        evaluationStatus: r.evaluationStatus,
        // A poor scan: the AI may have misread it, so its marks need a careful look.
        scanQuality: r.quality,
        identityMasked: masked,
      };
    });
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
  }

  // No exam to go by (older sheets saved without one): the class's students and its sheets.
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
      // A poor scan: the AI may have misread it, so its marks need a careful look.
      scanQuality: scanQualityView(sheet),
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

// ── Teacher: mark evaluation as reviewed ─────────────────────────────────────

/**
 * The evaluator marks their sections reviewed (or one section, `sectionId`; "" = students
 * without a section). An admin acts for every section, or the one named.
 */
const markReviewed = async (user: any, examId: string, reviewed: boolean = true, sectionRaw?: unknown) => {
  const instituteId = user.instituteId;
  const cleanExamId = clean(examId);
  if (!cleanExamId) throw new ApiError(httpStatus.BAD_REQUEST, "examId is required.");

  const all = await EvaluationAssignment.findAll({ where: { instituteId, examId: cleanExamId, isActive: true } });
  if (!all.length) {
    throw new ApiError(httpStatus.NOT_FOUND, "No active evaluation assignment found for this exam.");
  }

  // A teacher reviews only the sections given to them.
  let targets = isTeacherRequester(user) ? all.filter((a) => a.teacherId === user.userId) : all;
  if (!targets.length) throw new ApiError(httpStatus.FORBIDDEN, "You are not assigned as the evaluator for this exam.");
  if (sectionRaw !== undefined && sectionRaw !== null) {
    targets = targets.filter((a) => sectionKey(a.sectionId) === sectionKey(String(sectionRaw)));
    if (!targets.length) throw new ApiError(httpStatus.FORBIDDEN, "You are not assigned to evaluate that section of this exam.");
  }

  // Reviewed means done: every sheet of those sections uploaded (or student absent) and evaluated.
  // Un-reviewing is blocked once results are published.
  if (reviewed) await assertReadyForReview(instituteId, cleanExamId, targets.map((a) => a.sectionId));
  else await assertNotPublished(cleanExamId);

  const updatedReviewedAt = reviewed ? new Date() : null;
  const updatedReviewedBy = reviewed ? user.userId : null;
  for (const a of targets) await a.update({ reviewedAt: updatedReviewedAt, reviewedBy: updatedReviewedBy });
  // Marks reopened: a cross-check in progress stops; it starts over after the next review.
  if (!reviewed) await closeRoundForReopen(cleanExamId);

  // Every admin hears the marks are confirmed: once every section is, the next step is theirs (publish).
  const exam: any = await loadExam(instituteId, cleanExamId);
  if (reviewed && exam) {
    const nameOf = new Map((await sectionsOfExam(exam)).map((s) => [sectionKey(s.sectionId), s.sectionName]));
    const done = reviewState(await buildRoster(exam), await activeEvaluators(cleanExamId)).reviewed;
    const teacherName = user.userName || "The evaluator";
    const label = workLabel(exam, targets.map((a) => nameOf.get(sectionKey(a.sectionId)) ?? ""));
    const admins = [...targets.map((a) => a.assignedBy), ...(await instituteAdminIds(instituteId))].filter((id): id is string => Boolean(id) && id !== user.userId);
    await notifyAll(
      [...new Set(admins)].map((userId) => ({
        instituteId,
        userId,
        type: "EVALUATION_REVIEWED",
        title: done ? "Ready to publish" : "Section reviewed",
        message: done
          ? `${teacherName} checked the marks of ${label} and marked it reviewed. Every section is reviewed: you can publish the results.`
          : `${teacherName} checked the marks of ${label} and marked it reviewed. Other sections of ${examLabel(exam)} are still being evaluated.`,
        referenceId: cleanExamId,
      }))
    ).catch(() => undefined);
  }

  return {
    examId: cleanExamId,
    assignmentId: targets[0].assignmentId,
    sections: targets.map((a) => a.sectionId),
    isReviewed: Boolean(updatedReviewedAt),
    reviewedAt: updatedReviewedAt,
    reviewedBy: updatedReviewedBy,
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
  markReviewed,
};
