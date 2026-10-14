import httpStatus from "http-status";
import Exam from "../../models/Exam.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Subject from "../../models/Subject.model";
import Session from "../../models/Session.model";
import Notification from "../../models/Notification.model";
import StudentProfile from "../../models/Student.model";
import Scanner from "../../models/Scanner.model";
import StudentResult from "../../models/StudentResult.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";
import { sequelize } from "../../config/sequelize";
import StudentService from "../student/student.service";
import { Op } from "sequelize";
import { checkTeacherForSubject } from "../teacher/teacherSubject.service";
import { newId } from "../../utils/idGenerator";
import { EXAM_TYPE_HINT, normalizeExamType } from "../../utils/examTypes";
import { examMarksLock, examStructureLock, examUsage } from "../academic/academicGuards.service";

/** Single exam-table status that drives Manage Exams + approval. */
export const EXAM_WORKFLOW_STATUSES = [
  "Draft",
  "Paper Created",
  "Pending Approval",
  "Approved",
  "Rejected",
  "Live",
  "Completed",
] as const;

// Approval works per SET (question paper + answer sheet of one exam set). Every set
// keeps its own status; the exam status is only a summary derived from its sets —
// it is never copied back onto the sets (that used to mark never-submitted sets
// as approved when a different set of the same exam was approved).

/** Summary exam status from the status of each set. */
export function deriveExamStatus(setStatuses: string[], hasAnyPackage: boolean): string {
  if (!hasAnyPackage) return "Draft";
  if (setStatuses.includes("PENDING_APPROVAL")) return "Pending Approval";
  if (setStatuses.includes("REJECTED")) return "Rejected";
  if (setStatuses.some((s) => s === "APPROVED" || s === "PUBLISHED")) return "Approved";
  return "Paper Created";
}

/** Recomputes the exam status from its sets (Live / Completed exams are left alone). */
export async function refreshExamStatus(examId: string): Promise<string | null> {
  const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
  if (!exam) return null;
  if (exam.status === "Live" || exam.status === "Completed") return exam.status;

  const QuestionPaper = (await import("../../models/question-paper/QuestionPaper.model")).default;
  const QuestionPaperAnswer = (await import("../../models/question-paper/StandardAnswer.model")).default;

  const [papers, answerCount] = await Promise.all([
    QuestionPaper.findAll({ where: { examId }, attributes: ["status"] }),
    QuestionPaperAnswer.count({ where: { examId } }),
  ]);

  const next = deriveExamStatus(
    papers.map((p) => p.status),
    papers.length > 0 || answerCount > 0
  );
  if (next !== exam.status) {
    await exam.update({ status: next });
  }
  return next;
}

export async function markExamPaperCreated(examId: string): Promise<void> {
  const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
  if (!exam) return;
  if (exam.status === "Draft") {
    await exam.update({ status: "Paper Created" });
  }
}

// ─── EXAM PLACEMENT CHECKS ────────────────────────────────────────────────────

const bad = (statusCode: number, message: string) => ({ error: true, statusCode, message });

/** Statuses an admin may set by hand; the rest come from the paper approval workflow. */
const MANUAL_STATUSES = ["Live", "Completed"];
const PAPER_APPROVED = ["Approved", "Live", "Completed"];

const checkMarks = (total: unknown, passing: unknown) => {
  const totalMarks = Number(total);
  const passingMarks = Number(passing);
  if (!Number.isInteger(totalMarks) || totalMarks < 1 || totalMarks > 1000) return "Total marks must be a whole number from 1 to 1000.";
  if (!Number.isInteger(passingMarks) || passingMarks < 0) return "Passing marks must be a whole number.";
  if (passingMarks > totalMarks) return "Passing marks can't be more than total marks.";
  return null;
};

/**
 * Session, class, subject and sections must exist and belong together:
 *  - the subject belongs to the class (and, if it is taught in one section only, to that section);
 *  - every section belongs to the class;
 *  - one subject + type + session has either one class-wide exam or per-section exams, never both
 *    (a student would otherwise sit the same paper twice).
 * Returns the sections to create exams for, or an error.
 */
const checkExamPlacement = async (
  instituteId: string,
  input: { sessionId: string; classId: string; subjectId: string; examType: string; sectionIds: (string | null)[] },
  exceptExamId?: string
): Promise<{ error: any } | { sectionIds: (string | null)[]; className: string }> => {
  const [session, cls, subject] = await Promise.all([
    Session.findOne({ where: { sessionId: input.sessionId, instituteId, isDeleted: false } }),
    Class.findOne({ where: { classId: input.classId, instituteId, isDeleted: false } }),
    Subject.findOne({ where: { subjectId: input.subjectId, instituteId, isDeleted: false } }),
  ]);
  if (!session) return { error: bad(httpStatus.BAD_REQUEST, "Choose a session that exists (Master Data → Sessions).") };
  if (!cls) return { error: bad(httpStatus.BAD_REQUEST, "Choose a class that exists (Master Data → Classes).") };
  if (!subject || subject.classId !== cls.classId) {
    return { error: bad(httpStatus.BAD_REQUEST, `This subject is not taught in Class ${cls.className}. Add it under Master Data → Subjects first.`) };
  }

  let sectionIds = input.sectionIds;
  const chosen = sectionIds.filter(Boolean) as string[];
  if (chosen.length) {
    const sections = await Section.findAll({ where: { sectionId: { [Op.in]: chosen }, classId: cls.classId, isDeleted: false } });
    if (sections.length !== new Set(chosen).size) {
      return { error: bad(httpStatus.BAD_REQUEST, `One of the chosen sections is not part of Class ${cls.className}.`) };
    }
  }
  // A subject taught in one section only can't have an exam for the whole class.
  if (subject.sectionId) {
    if (!chosen.length) sectionIds = [subject.sectionId];
    else if (chosen.some((id) => id !== subject.sectionId)) {
      return { error: bad(httpStatus.BAD_REQUEST, `${subject.subjectName} is taught in one section only; create the exam for that section.`) };
    }
  }

  const siblings = await Exam.findAll({
    where: {
      instituteId,
      isDeleted: false,
      sessionId: session.sessionId,
      classId: cls.classId,
      subjectId: subject.subjectId,
      examType: input.examType,
      ...(exceptExamId ? { examId: { [Op.ne]: exceptExamId } } : {}),
    },
    attributes: ["examId", "sectionId"],
  });
  const classWide = siblings.some((e) => !e.sectionId);
  for (const secId of sectionIds) {
    if (!secId && siblings.length) {
      return {
        error: bad(
          httpStatus.CONFLICT,
          `A ${input.examType} exam for ${subject.subjectName} already exists in Class ${cls.className}${classWide ? "" : " for some sections"}.`
        ),
      };
    }
    if (secId && classWide) {
      return { error: bad(httpStatus.CONFLICT, `A ${input.examType} exam for ${subject.subjectName} already covers the whole of Class ${cls.className}.`) };
    }
  }
  return { sectionIds, className: cls.className };
};

// ─── CREATE EXAM ──────────────────────────────────────────────────────────────
const createExam = async (body: any, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    if (!instituteId) return bad(httpStatus.BAD_REQUEST, "Institute not found for this user.");

    const examType = normalizeExamType(body.examType);
    if (!examType) return bad(httpStatus.BAD_REQUEST, EXAM_TYPE_HINT);
    const marksError = checkMarks(body.totalMarks, body.passingMarks);
    if (marksError) return bad(httpStatus.BAD_REQUEST, marksError);

    // The paper setter must be an active teacher of the institute who can teach the subject.
    const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });
    const teacher = await UserModal.findOne({
      where: { userId: body.teacherId, instituteId, roleId: teacherRole?.id, status: 1, isDeleted: false },
    });
    if (!teacher) return bad(httpStatus.NOT_FOUND, "Teacher not found in your institute.");
    const fit = await checkTeacherForSubject(instituteId, teacher.userId, body.subjectId);
    if (!fit.ok) return bad(httpStatus.BAD_REQUEST, fit.message ?? "This teacher can't teach the subject.");

    // "ALL" (or nothing) = one exam for the whole class; otherwise one exam per chosen section.
    const requested: string[] = (Array.isArray(body.sectionIds) ? body.sectionIds : [body.sectionId])
      .filter((id: unknown) => id && id !== "ALL")
      .map(String);
    const placement = await checkExamPlacement(instituteId, {
      sessionId: String(body.sessionId ?? ""),
      classId: String(body.classId ?? ""),
      subjectId: String(body.subjectId ?? ""),
      examType,
      sectionIds: requested.length ? Array.from(new Set(requested)) : [null],
    });
    if ("error" in placement) return placement.error;

    const createdExams = await sequelize.transaction(async (t) => {
      const rows: Exam[] = [];
      for (const sectionId of placement.sectionIds) {
        const examId = newId("exam");
        rows.push(
          await Exam.create(
            {
              examId,
              instituteId,
              sessionId: body.sessionId,
              examType,
              classId: body.classId,
              sectionId,
              subjectId: body.subjectId,
              teacherId: teacher.userId,
              examinerId: createdBy.userId,
              totalMarks: Number(body.totalMarks),
              passingMarks: Number(body.passingMarks),
              duration: body.duration ? Number(body.duration) : null,
              instructions: body.instructions || null,
              examDate: body.examDate || null,
              examTime: body.examTime || null,
              status: "Draft",
            },
            { transaction: t }
          )
        );
        await Notification.create(
          {
            notificationId: newId("notification"),
            instituteId,
            userId: teacher.userId,
            type: "EXAM_ASSIGNED",
            title: "New Exam Assigned",
            message: `A ${examType} exam has been assigned to you.`,
            referenceId: examId,
          },
          { transaction: t }
        );
      }
      return rows;
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: createdExams.length === 1 ? "Exam created." : `${createdExams.length} exams created (one per section).`,
      data: createdExams.length === 1 ? createdExams[0] : createdExams,
    };
  } catch (e: any) {
    console.error(e);
    return bad(httpStatus.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
  }
};

// ─── GET ALL EXAMS ────────────────────────────────────────────────────────────
const getAllExams = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const { search = "", status = "", classVal = "" } = query;

    const where: any = { instituteId, isDeleted: false };
    if (status) where.status = status;
    if (classVal) where.classVal = classVal;
    if (search) {
      where[Op.or] = [
        { examType: { [Op.iLike]: `%${search}%` } },
        { subject: { [Op.iLike]: `%${search}%` } },
        { classVal: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const exams = await Exam.findAll({
      where,
      include: [
        { model: Class, as: "class", where: { isDeleted: false }, required: true },
        { model: Section, as: "section", attributes: ["sectionId", "sectionName"], required: false },
        { model: Subject, as: "subject", where: { isDeleted: false }, required: true },
        { model: UserModal, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
        { model: Session, as: "session", attributes: ["sessionId", "sessionName"], required: false },
      ],
      order: [["createdAt", "DESC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exams fetched successfully.",
      data: { exams, total: exams.length },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ASSIGNED EXAMS (FOR TEACHER) ─────────────────────────────────────────
const getAssignedExams = async (requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const teacherId = requestedBy.userId;

    const exams: any = await Exam.findAll({
      where: {
        instituteId,
        isDeleted: false,
        teacherId
      },
      include: [
        { model: Class, as: "class", attributes: ["className"], where: { isDeleted: false }, required: true },
        { model: Section, as: "section", attributes: ["sectionName"], required: false }, // exams might not have section
        { model: Subject, as: "subject", attributes: ["subjectName"], where: { isDeleted: false }, required: true },
        { model: Session, as: "session", attributes: ["sessionName"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const formattedExams = await Promise.all(exams.map(async (exam: any) => {
      const totalStudents = await StudentProfile.count({
        where: { instituteId, classId: exam.classId, isActive: true }
      });
      const uploadedSheets = await Scanner.count({
        where: {
          instituteId,
          classId: exam.classId,
          subjectId: exam.subjectId,
          examType: exam.examType,
          isDeleted: false
        }
      });
      return {
        id: exam.examId,
        examId: exam.examId,
        classId: exam.class?.classId || exam.classId,
        className: exam.class?.className || "N/A",
        sectionId: exam.section?.sectionId || exam.sectionId,
        sectionName: exam.section?.sectionName || "N/A",
        subjectId: exam.subject?.subjectId || exam.subjectId,
        subjectName: exam.subject?.subjectName || "N/A",
        sessionId: exam.session?.sessionId || exam.sessionId,
        sessionName: exam.session?.sessionName || "N/A",
        examType: exam.examType,
        status: exam.status,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        duration: exam.duration,
        instructions: exam.instructions,
        teacherId: exam.teacherId,
        examinerId: exam.examinerId,
        totalStudents,
        uploadedSheets,
        createdAt: exam.createdAt,
        updatedAt: exam.updatedAt
      };
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Assigned exams fetched successfully.",
      data: { exams: formattedExams },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ONE EXAM ─────────────────────────────────────────────────────────────
const getExamById = async (examId: string, requestedBy: any): Promise<any> => {
  try {
    const exam = await Exam.findOne({
      where: { examId, isDeleted: false },
      include: [
        { model: Class, as: "class", where: { isDeleted: false }, required: true },
        { model: Section, as: "section", attributes: ["sectionId", "sectionName"], required: false },
        { model: Subject, as: "subject", where: { isDeleted: false }, required: true },
        { model: UserModal, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
        { model: Session, as: "session", attributes: ["sessionId", "sessionName"], required: false },
      ],
    });

    if (!exam) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    // Check institute access
    if (requestedBy.instituteId !== exam.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam fetched successfully.",
      data: exam,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE EXAM STATUS ───────────────────────────────────────────────────────
/** Synchronizes QuestionPaper and QuestionPaperAnswer statuses when an Exam status is updated.
 *  Only touches papers/answers that have been submitted (status != DRAFT).
 *  DRAFT papers are ones the teacher hasn't submitted yet and must not be touched. */
async function syncQuestionPaperStatuses(examId: string, status: string): Promise<void> {
  try {
    const dbStatusMap: Record<string, string> = {
      "Pending Approval": "PENDING_APPROVAL",
      "Approved": "APPROVED",
      "Rejected": "REJECTED",
      "Completed": "APPROVED",
      "PENDING_APPROVAL": "PENDING_APPROVAL",
      "APPROVED": "APPROVED",
      "REJECTED": "REJECTED",
      "Live": "PUBLISHED",
      "PUBLISHED": "PUBLISHED",
    };

    const targetStatus = dbStatusMap[status];
    if (!targetStatus) return;

    const QuestionPaper = (await import("../../models/question-paper/QuestionPaper.model")).default;
    const QuestionPaperAnswer = (await import("../../models/question-paper/StandardAnswer.model")).default;
    const { Op } = await import("sequelize");

    const now = new Date();
    const updatePayload: any = { status: targetStatus };
    if (targetStatus === "APPROVED") updatePayload.approvedAt = now;
    if (targetStatus === "PENDING_APPROVAL") updatePayload.submittedAt = now;
    if (targetStatus === "REJECTED") updatePayload.rejectedAt = now;

    // Only update papers/answers that have been submitted (not DRAFT).
    // DRAFT papers are ones the teacher hasn't submitted yet and should not be touched.
    await Promise.all([
      QuestionPaper.update(updatePayload, { where: { examId, status: { [Op.ne]: "DRAFT" } } }),
      QuestionPaperAnswer.update(updatePayload, { where: { examId, status: { [Op.ne]: "DRAFT" } } }),
    ]);
  } catch (err: any) {
    console.error("syncQuestionPaperStatuses error:", err?.message || err);
  }
}

const updateExamStatus = async (
  examId: string,
  status: string,
  requestedBy: any,
): Promise<any> => {
  try {
    const allowed = [...EXAM_WORKFLOW_STATUSES];
    if (!allowed.includes(status as any)) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Status must be one of: ${allowed.join(", ")}`,
      };
    }

    const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
    if (!exam) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    if (requestedBy.instituteId !== exam.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    if (status !== exam.status) {
      if (!MANUAL_STATUSES.includes(status)) {
        return bad(httpStatus.BAD_REQUEST, "Paper statuses (submitted, approved, rejected) change through Exam Approvals, not here.");
      }
      if (!PAPER_APPROVED.includes(exam.status)) {
        return bad(httpStatus.BAD_REQUEST, "Approve the question paper before marking the exam live or completed.");
      }
    }

    await exam.update({ status });
    await syncQuestionPaperStatuses(examId, status);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Exam status updated to ${status}.`,
      data: exam,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE EXAM  ───────────────────────────────────────────────────────
// Details (date, time, duration, instructions, paper setter) can always change.
// Session / class / section / subject / type lock once the exam has papers,
// assignments, sheets or results; marks lock once sheets or results exist.
// Approval statuses are set by the approval workflow, never by hand.
const updateExam = async (examId: string, body: any, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const exam = await Exam.findOne({ where: { examId, instituteId, isDeleted: false } });
    if (!exam) return bad(httpStatus.NOT_FOUND, "Exam not found.");
    if (exam.status === "Completed") return bad(httpStatus.BAD_REQUEST, "A completed exam can't be changed.");

    // The edit dialog sends sessionId / subjectId / classId / teacherId; older callers session / subject.
    const nextSessionId = String(body.sessionId || body.session || exam.sessionId);
    const nextClassId = String(body.classId || exam.classId);
    const nextSubjectId = String(body.subjectId || body.subject || exam.subjectId);
    const nextSectionId = body.sectionId !== undefined ? (body.sectionId && body.sectionId !== "ALL" ? String(body.sectionId) : null) : exam.sectionId ?? null;
    const typeChanged = body.examType !== undefined && body.examType !== exam.examType;
    const nextType = typeChanged ? normalizeExamType(body.examType) : exam.examType;
    if (!nextType) return bad(httpStatus.BAD_REQUEST, EXAM_TYPE_HINT);
    const nextTeacherId = String(body.teacherId || exam.teacherId);

    const structureChanged =
      nextSessionId !== exam.sessionId ||
      nextClassId !== exam.classId ||
      nextSubjectId !== exam.subjectId ||
      nextSectionId !== (exam.sectionId ?? null) ||
      nextType !== exam.examType;
    const nextTotal = body.totalMarks !== undefined && body.totalMarks !== "" ? Number(body.totalMarks) : exam.totalMarks;
    const nextPassing = body.passingMarks !== undefined && body.passingMarks !== "" ? Number(body.passingMarks) : exam.passingMarks;
    const marksChanged = nextTotal !== exam.totalMarks || nextPassing !== exam.passingMarks;

    if (structureChanged || marksChanged) {
      const usage = await examUsage(examId);
      const structureLock = structureChanged ? examStructureLock(usage) : null;
      if (structureLock) return bad(httpStatus.CONFLICT, structureLock);
      const marksLock = marksChanged ? examMarksLock(usage) : null;
      if (marksLock) return bad(httpStatus.CONFLICT, marksLock);
    }
    if (marksChanged) {
      const marksError = checkMarks(nextTotal, nextPassing);
      if (marksError) return bad(httpStatus.BAD_REQUEST, marksError);
    }
    if (structureChanged) {
      const placement = await checkExamPlacement(
        instituteId,
        { sessionId: nextSessionId, classId: nextClassId, subjectId: nextSubjectId, examType: nextType, sectionIds: [nextSectionId] },
        examId
      );
      if ("error" in placement) return placement.error;
    }

    // Status: only Live / Completed by hand, and only after the paper is approved.
    let nextStatus = exam.status;
    if (body.status && body.status !== exam.status) {
      if (!MANUAL_STATUSES.includes(body.status)) {
        return bad(httpStatus.BAD_REQUEST, "Paper statuses (submitted, approved, rejected) change through Exam Approvals, not here.");
      }
      if (!PAPER_APPROVED.includes(exam.status)) {
        return bad(httpStatus.BAD_REQUEST, "Approve the question paper before marking the exam live or completed.");
      }
      nextStatus = body.status;
    }

    if (nextTeacherId !== exam.teacherId || nextSubjectId !== exam.subjectId) {
      const fit = await checkTeacherForSubject(instituteId, nextTeacherId, nextSubjectId);
      if (!fit.ok) return bad(httpStatus.BAD_REQUEST, fit.message ?? "This teacher can't teach the subject.");
    }
    const teacherChanged = nextTeacherId !== exam.teacherId;
    const statusChanged = nextStatus !== exam.status;

    await exam.update({
      sessionId: nextSessionId,
      examType: nextType,
      classId: nextClassId,
      sectionId: nextSectionId,
      subjectId: nextSubjectId,
      teacherId: nextTeacherId,
      totalMarks: nextTotal,
      passingMarks: nextPassing,
      duration: body.duration !== undefined ? (body.duration ? Number(body.duration) : null) : exam.duration,
      instructions: body.instructions !== undefined ? body.instructions || null : exam.instructions,
      examDate: body.examDate !== undefined ? body.examDate || null : exam.examDate,
      examTime: body.examTime !== undefined ? body.examTime || null : exam.examTime,
      status: nextStatus,
    });
    if (statusChanged) await syncQuestionPaperStatuses(examId, nextStatus);

    // Tell the newly assigned teacher, like on create.
    if (teacherChanged) {
      await Notification.create({
        notificationId: newId("notification"),
        instituteId,
        userId: nextTeacherId,
        type: "EXAM_ASSIGNED",
        title: "Exam Assigned",
        message: `A ${exam.examType} exam has been assigned to you.`,
        referenceId: exam.examId,
      }).catch((err: any) => console.error("Exam reassignment notification failed:", err?.message));
    }

    return { error: false, statusCode: 200, message: "Exam updated.", data: exam };
  } catch (e: any) {
    return bad(500, `Something went wrong: ${e.message}`);
  }
};

// ─── SOFT DELETE EXAM ─────────────────────────────────────────────────────────
const deleteExam = async (examId: string, requestedBy: any): Promise<any> => {
  try {
    const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
    if (!exam) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    if (requestedBy.instituteId !== exam.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    // An exam with scanned sheets or published results is a record; it can't
    // just disappear. Without them it is soft-deleted together with its
    // scanner / evaluator assignments, all or nothing.
    const [sheets, results] = await Promise.all([
      Scanner.count({ where: { instituteId: exam.instituteId, examId, isDeleted: false } }),
      StudentResult.count({ where: { examId, isDeleted: false } }),
    ]);
    if (sheets || results) {
      const used = [sheets && `${sheets} answer sheet${sheets === 1 ? "" : "s"}`, results && "published results"].filter(Boolean).join(" and ");
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: `This exam can't be deleted because it has ${used}.`,
      };
    }

    await sequelize.transaction(async (t) => {
      await exam.update({ isDeleted: true }, { transaction: t });
      const unassignedAt = new Date();
      await EvaluationAssignment.update({ isActive: false, unassignedAt }, { where: { examId, isActive: true }, transaction: t });
      await ExamScannerAssignment.update({ isActive: false, unassignedAt }, { where: { examId, isActive: true }, transaction: t });
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam deleted successfully.",
      data: {},
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};


// ─── GET EXAM PROGRESS ────────────────────────────────────────────────────────
const getExamProgress = async (examId: string, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;

    const exam: any = await Exam.findOne({
      where: { examId, instituteId, isDeleted: false },
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"], required: true },
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: true },
        { model: Session, as: "session", attributes: ["sessionId", "sessionName"] },
      ],
    });

    if (!exam) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Exam not found." };
    }

    const sections: any = await Section.findAll({
      where: { classId: exam.classId, isDeleted: false },
    });

    const className = exam.class?.className || exam.classId;
    const sessionName = exam.session?.sessionName || exam.sessionId || "";

    const progressData = await Promise.all(
      sections.map(async (sec: any) => {
        let studentsList: any[] = [];
        try {
          const studentRes = await StudentService.getAllStudents(requestedBy, {
            className,
            sectionId: sec.sectionName || sec.sectionId,
            session: sessionName,
          });
          if (studentRes && !studentRes.error && Array.isArray(studentRes?.data?.students)) {
            studentsList = studentRes.data.students;
          }
        } catch (err) {
          console.error("Error fetching section progress students:", err);
        }

        const studentRolls = new Set(
          studentsList.map((s: any) => String(s.rollNumber)).filter(Boolean)
        );

        const sheets = await Scanner.findAll({
          where: {
            instituteId,
            classId: exam.classId,
            section: { [Op.in]: [sec.sectionId, sec.sectionName] },
            subjectId: exam.subjectId,
            examType: exam.examType,
            isDeleted: false,
          },
          attributes: ["sheetId", "rollNo"],
        });

        const orphanSheets = sheets.filter(
          (sh: any) => !studentRolls.has(String(sh.rollNo))
        );

        const totalStudents = studentsList.length + orphanSheets.length;
        const uploadedSheets = sheets.length;

        return {
          sectionId: sec.sectionId,
          sectionName: sec.sectionName,
          totalStudents,
          uploadedSheets,
        };
      })
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Progress fetched successfully.",
      data: { progress: progressData },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ASSIGNED EXAMS SUMMARY (section-aware counts) ────────────────────────
// New endpoint for the answersheetevaluation page.
// Unlike getAssignedExams, this filters totalStudents and uploadedSheets
// by the exam's sectionId so counts match the uploaded-sheets detail page.
const getAssignedExamsSummary = async (requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const teacherId = requestedBy.userId;

    const exams: any = await Exam.findAll({
      where: { instituteId, isDeleted: false, teacherId },
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"], where: { isDeleted: false }, required: true },
        { model: Section, as: "section", attributes: ["sectionId", "sectionName"], required: false },
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], where: { isDeleted: false }, required: true },
        { model: Session, as: "session", attributes: ["sessionId", "sessionName"] },
      ],
      order: [["createdAt", "DESC"]],
    });

    const formattedExams = await Promise.all(
      exams.map(async (exam: any) => {
        const className = exam.class?.className || exam.classId;
        const sectionName = exam.section?.sectionName || exam.sectionId || "";
        const sessionName = exam.session?.sessionName || exam.sessionId || "";

        // 1. Get students matching exact same query as uploaded-sheets detail page
        let studentsList: any[] = [];
        try {
          const studentRes = await StudentService.getAllStudents(requestedBy, {
            className,
            sectionId: sectionName,
            session: sessionName,
          });
          if (studentRes && !studentRes.error && Array.isArray(studentRes?.data?.students)) {
            studentsList = studentRes.data.students;
          }
        } catch (err) {
          console.error("Error fetching students for exam summary:", err);
        }

        const studentRolls = new Set(
          studentsList.map((s: any) => String(s.rollNumber)).filter(Boolean)
        );

        // 2. Get uploaded sheets matching the exam parameters
        const sectionVals = Array.from(
          new Set([exam.sectionId, exam.section?.sectionName].filter(Boolean))
        );
        const classVals = Array.from(
          new Set([exam.classId, exam.class?.className].filter(Boolean))
        );

        const sheetWhere: any = {
          instituteId,
          subjectId: exam.subjectId,
          examType: exam.examType,
          isDeleted: false,
        };

        if (classVals.length > 0) {
          sheetWhere.classId = { [Op.in]: classVals };
        }
        if (sectionVals.length > 0) {
          sheetWhere.section = { [Op.in]: sectionVals };
        }

        const sheets = await Scanner.findAll({
          where: sheetWhere,
          attributes: ["sheetId", "rollNo"],
        });

        const orphanSheets = sheets.filter(
          (sh: any) => !studentRolls.has(String(sh.rollNo))
        );

        const totalStudents = studentsList.length + orphanSheets.length;
        const uploadedSheets = sheets.length;

        return {
          id: exam.examId,
          examId: exam.examId,
          classId: exam.class?.classId || exam.classId,
          className: exam.class?.className || "N/A",
          sectionId: exam.section?.sectionId || exam.sectionId || null,
          sectionName: exam.section?.sectionName || "N/A",
          subjectId: exam.subject?.subjectId || exam.subjectId,
          subjectName: exam.subject?.subjectName || "N/A",
          sessionId: exam.session?.sessionId || exam.sessionId,
          sessionName: exam.session?.sessionName || "N/A",
          examType: exam.examType,
          status: exam.status,
          totalMarks: exam.totalMarks,
          passingMarks: exam.passingMarks,
          duration: exam.duration,
          instructions: exam.instructions,
          teacherId: exam.teacherId,
          examinerId: exam.examinerId,
          totalStudents,
          uploadedSheets,
          createdAt: exam.createdAt,
          updatedAt: exam.updatedAt
        };
      })
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Assigned exams summary fetched successfully.",
      data: { exams: formattedExams },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  getExamProgress,
  createExam,
  getAllExams,
  getExamById,
  updateExamStatus,
  updateExam,
  deleteExam,
  getAssignedExams,
  getAssignedExamsSummary,
};
