"use strict";
// import httpStatus from "http-status";
// import { Op } from "sequelize";
// import { sequelize } from "../config/sequelize";
// import QuestionPaper from "../modals/QuestionPaper.modal";
// import Exam from "../modals/Exam.modal";
// import User from "../modals/User.modal";
// import TeacherProfile from "../modals/TeacherProfile.modal";
// import RegHelper from "../utils/helper";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionPaperService = void 0;
// // ─────────────────────────────────────────────────────────────────
// // Helper: summarise questions inside a paper for quick display
// // ─────────────────────────────────────────────────────────────────
// const summarisePaper = (content: any) => {
//   const questions: any[] = content?.questions ?? [];
//   return {
//     questionCount: questions.length,
//     totalMarks: questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0),
//     sections: questions.reduce((acc: Record<string, number>, q) => {
//       acc[q.section] = (acc[q.section] || 0) + 1;
//       return acc;
//     }, {}),
//   };
// };
// // ═════════════════════════════════════════════════════════════════
// // 1. saveDraft
// //    Teacher creates or updates a question paper draft
// // ═════════════════════════════════════════════════════════════════
// const saveDraft = async (
//   userId: string,
//   instituteId: string,
//   body: { examId: string; content: object },
// ): Promise<any> => {
//   try {
//     const { examId, content } = body;
//     // ── Verify exam exists, belongs to institute ─────────────────
//     const exam = await Exam.findOne({
//       where: {
//         examId,
//         instituteId,
//         status: { [Op.notIn]: ["Deleted"] },
//       },
//     });
//     if (!exam) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Exam not found or does not belong to your institute.",
//       };
//     }
//     // ── Only the assigned teacher can work on this exam ──────────
//     if (exam.teacherId !== userId) {
//       return {
//         error: true,
//         statusCode: httpStatus.FORBIDDEN,
//         message: "You are not assigned to this exam.",
//       };
//     }
//     // ── Cannot edit once exam is Live or Completed ───────────────
//     if (["Live", "Completed"].includes(exam.status)) {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: `Cannot edit question paper. Exam is already ${exam.status}.`,
//       };
//     }
//     // ── Check if a paper already exists for this exam + teacher ──
//     const existing = await QuestionPaper.findOne({
//       where: { examId, teacherId: userId },
//     });
//     if (existing) {
//       // Cannot overwrite Submitted or Approved paper
//       if (["Submitted", "Approved"].includes(existing.status)) {
//         return {
//           error: true,
//           statusCode: httpStatus.BAD_REQUEST,
//           message: `Question paper is already ${existing.status}. Cannot save draft.`,
//         };
//       }
//       // Update existing draft (or rejected paper being revised)
//       await existing.update({
//         content,
//         status: "Draft",
//         rejectionNote: null,
//       });
//       return {
//         error: false,
//         statusCode: httpStatus.OK,
//         message: "Draft updated successfully.",
//         data: { paperId: existing.paperId, status: "Draft" },
//       };
//     }
//     // ── Create brand new paper ───────────────────────────────────
//     const paperId = await RegHelper.generateUserId();
//     const paper = await QuestionPaper.create({
//       paperId,
//       examId,
//       teacherId: userId,
//       instituteId,
//       content,
//       status: "Draft",
//       rejectionNote: null,
//       submittedAt: null,
//       approvedAt: null,
//       rejectedAt: null,
//     });
//     return {
//       error: false,
//       statusCode: httpStatus.CREATED,
//       message: "Question paper draft saved.",
//       data: { paperId: paper.paperId, status: "Draft" },
//     };
//   } catch (e: any) {
//     console.error("[saveDraft]", e);
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };
// // ═════════════════════════════════════════════════════════════════
// // 2. submitPaper
// //    Teacher submits a Draft / Rejected paper for examiner review
// // ═════════════════════════════════════════════════════════════════
// const submitPaper = async (
//   userId: string,
//   instituteId: string,
//   paperId: string,
// ): Promise<any> => {
//   const t = await sequelize.transaction();
//   try {
//     const paper = await QuestionPaper.findOne({
//       where: { paperId },
//       include: [
//         {
//           model: Exam,
//           as: "exam",
//           where: { instituteId },
//           attributes: ["examId", "status"],
//         },
//       ],
//     });
//     if (!paper) {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Question paper not found.",
//       };
//     }
//     // Only the author can submit
//     if (paper.teacherId !== userId) {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.FORBIDDEN,
//         message: "You are not the author of this question paper.",
//       };
//     }
//     if (!["Draft", "Rejected"].includes(paper.status)) {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: `Cannot submit. Paper is currently ${paper.status}.`,
//       };
//     }
//     // Must have at least one question
//     const content: any = paper.content;
//     if (!content?.questions?.length) {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message:
//           "Cannot submit an empty question paper. Add at least one question.",
//       };
//     }
//     // Update paper → Submitted
//     await paper.update(
//       { status: "Submitted", rejectionNote: null, submittedAt: new Date() },
//       { transaction: t },
//     );
//     // Update exam → Submitted (only if it was Draft)
//     await Exam.update(
//       { status: "Submitted" },
//       { where: { examId: paper.examId, status: "Draft" }, transaction: t },
//     );
//     await t.commit();
//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Question paper submitted for review.",
//       data: { paperId, status: "Submitted" },
//     };
//   } catch (e: any) {
//     await t.rollback();
//     console.error("[submitPaper]", e);
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };
// // ═════════════════════════════════════════════════════════════════
// // 3. getMyExams
// //    Teacher views all exams assigned to them + paper status
// // ═════════════════════════════════════════════════════════════════
// const getMyExams = async (
//   userId: string,
//   instituteId: string,
//   query: any,
// ): Promise<any> => {
//   try {
//     const { status, page = 1, limit = 10 } = query;
//     const parsedPage = Math.max(1, parseInt(page));
//     const parsedLimit = Math.max(1, parseInt(limit));
//     const offset = (parsedPage - 1) * parsedLimit;
//     // Build exam where clause
//     const examWhere: any = {
//       teacherId: userId,
//       instituteId,
//       status: { [Op.notIn]: ["Deleted"] },
//     };
//     // Build paper where clause (for filtering by paper status)
//     const paperWhere: any = {};
//     if (status) paperWhere.status = status;
//     const { count, rows } = await Exam.findAndCountAll({
//       where: examWhere,
//       include: [
//         {
//           model: QuestionPaper,
//           as: "questionPaper",
//           where: Object.keys(paperWhere).length ? paperWhere : undefined,
//           required: !!status, // INNER JOIN only when filtering by status, otherwise LEFT JOIN
//           attributes: [
//             "paperId",
//             "status",
//             "rejectionNote",
//             "submittedAt",
//             "updatedAt",
//             "content",
//           ],
//         },
//       ],
//       order: [["createdAt", "DESC"]],
//       limit: parsedLimit,
//       offset,
//       distinct: true,
//     });
//     const data = rows.map((exam: any) => {
//       const paper = exam.questionPaper;
//       let paperData = null;
//       if (paper) {
//         const summary = summarisePaper(paper.content);
//         paperData = {
//           paperId: paper.paperId,
//           status: paper.status,
//           rejectionNote: paper.rejectionNote || null,
//           submittedAt: paper.submittedAt,
//           lastUpdated: paper.updatedAt,
//           ...summary,
//         };
//       }
//       return {
//         examId: exam.examId,
//         session: exam.session,
//         examType: exam.examType,
//         class: exam.classVal,
//         subject: exam.subject,
//         examStatus: exam.status,
//         examCreatedAt: exam.createdAt,
//         paper: paperData, // null = teacher hasn't started yet
//       };
//     });
//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Exams fetched successfully.",
//       data: {
//         exams: data,
//         pagination: {
//           total: count,
//           page: parsedPage,
//           limit: parsedLimit,
//           totalPages: Math.ceil(count / parsedLimit),
//         },
//       },
//     };
//   } catch (e: any) {
//     console.error("[getMyExams]", e);
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };
// // ═════════════════════════════════════════════════════════════════
// // 4. getSubmittedPapers
// //    Examiner views all submitted papers pending review
// // ═════════════════════════════════════════════════════════════════
// const getSubmittedPapers = async (
//   instituteId: string,
//   query: any,
// ): Promise<any> => {
//   try {
//     const { class: classFilter, subject, page = 1, limit = 10 } = query;
//     const parsedPage = Math.max(1, parseInt(page));
//     const parsedLimit = Math.max(1, parseInt(limit));
//     const offset = (parsedPage - 1) * parsedLimit;
//     // Exam-level filters
//     const examWhere: any = {
//       instituteId,
//       status: { [Op.notIn]: ["Deleted"] },
//     };
//     if (classFilter) examWhere.classVal = classFilter;
//     if (subject) examWhere.subject = subject;
//     const { count, rows } = await QuestionPaper.findAndCountAll({
//       where: { status: "Submitted", instituteId },
//       include: [
//         {
//           model: Exam,
//           as: "exam",
//           where: examWhere,
//           attributes: [
//             "examId",
//             "session",
//             "examType",
//             "classVal",
//             "subject",
//             "status",
//           ],
//         },
//         {
//           model: User,
//           as: "teacher",
//           attributes: ["userId", "userName", "emailId"],
//           include: [
//             {
//               model: TeacherProfile,
//               as: "teacherProfile",
//               attributes: ["employeeID", "specialization"],
//             },
//           ],
//         },
//       ],
//       order: [["submittedAt", "ASC"]], // oldest first — review queue order
//       limit: parsedLimit,
//       offset,
//       distinct: true,
//     });
//     const data = rows.map((paper: any) => ({
//       paperId: paper.paperId,
//       examId: paper.examId,
//       status: paper.status,
//       submittedAt: paper.submittedAt,
//       lastUpdated: paper.updatedAt,
//       exam: {
//         session: paper.exam.session,
//         examType: paper.exam.examType,
//         class: paper.exam.classVal,
//         subject: paper.exam.subject,
//         examStatus: paper.exam.status,
//       },
//       teacher: {
//         teacherId: paper.teacher.userId,
//         name: paper.teacher.userName,
//         email: paper.teacher.emailId,
//         employeeId: paper.teacher.teacherProfile?.employeeID ?? null,
//         specialization: paper.teacher.teacherProfile?.specialization ?? null,
//       },
//       paperSummary: summarisePaper(paper.content),
//     }));
//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Submitted papers fetched successfully.",
//       data: {
//         papers: data,
//         pagination: {
//           total: count,
//           page: parsedPage,
//           limit: parsedLimit,
//           totalPages: Math.ceil(count / parsedLimit),
//         },
//       },
//     };
//   } catch (e: any) {
//     console.error("[getSubmittedPapers]", e);
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };
// // ═════════════════════════════════════════════════════════════════
// // 5. approvePaper
// //    Examiner approves → paper = Approved, exam = Live
// // ═════════════════════════════════════════════════════════════════
// const approvePaper = async (
//   instituteId: string,
//   paperId: string,
// ): Promise<any> => {
//   const t = await sequelize.transaction();
//   try {
//     const paper = await QuestionPaper.findOne({
//       where: { paperId },
//       include: [
//         {
//           model: Exam,
//           as: "exam",
//           where: { instituteId },
//           attributes: ["examId", "status"],
//         },
//       ],
//     });
//     if (!paper) {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Question paper not found.",
//       };
//     }
//     if (paper.status !== "Submitted") {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: `Cannot approve. Paper status is '${paper.status}'. Only Submitted papers can be approved.`,
//       };
//     }
//     // Paper → Approved
//     await paper.update(
//       { status: "Approved", rejectionNote: null, approvedAt: new Date() },
//       { transaction: t },
//     );
//     // Exam → Live
//     await Exam.update(
//       { status: "Live" },
//       { where: { examId: paper.examId }, transaction: t },
//     );
//     await t.commit();
//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Question paper approved. Exam is now Live.",
//       data: {
//         paperId,
//         paperStatus: "Approved",
//         examId: paper.examId,
//         examStatus: "Live",
//       },
//     };
//   } catch (e: any) {
//     await t.rollback();
//     console.error("[approvePaper]", e);
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };
// // ═════════════════════════════════════════════════════════════════
// // 6. rejectPaper
// //    Examiner rejects → paper = Rejected (with note), exam = Draft
// // ═════════════════════════════════════════════════════════════════
// const rejectPaper = async (
//   instituteId: string,
//   paperId: string,
//   rejectionNote: string,
// ): Promise<any> => {
//   const t = await sequelize.transaction();
//   try {
//     if (!rejectionNote?.trim()) {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "rejectionNote is required when rejecting a paper.",
//       };
//     }
//     const paper = await QuestionPaper.findOne({
//       where: { paperId },
//       include: [
//         {
//           model: Exam,
//           as: "exam",
//           where: { instituteId },
//           attributes: ["examId", "status"],
//         },
//       ],
//     });
//     if (!paper) {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Question paper not found.",
//       };
//     }
//     if (paper.status !== "Submitted") {
//       await t.rollback();
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: `Cannot reject. Paper status is '${paper.status}'. Only Submitted papers can be rejected.`,
//       };
//     }
//     const note = rejectionNote.trim();
//     // Paper → Rejected
//     await paper.update(
//       { status: "Rejected", rejectionNote: note, rejectedAt: new Date() },
//       { transaction: t },
//     );
//     // Exam → back to Draft
//     await Exam.update(
//       { status: "Draft" },
//       { where: { examId: paper.examId, status: "Submitted" }, transaction: t },
//     );
//     await t.commit();
//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Question paper rejected. Teacher will be notified to revise.",
//       data: {
//         paperId,
//         paperStatus: "Rejected",
//         examId: paper.examId,
//         examStatus: "Draft",
//         rejectionNote: note,
//       },
//     };
//   } catch (e: any) {
//     await t.rollback();
//     console.error("[rejectPaper]", e);
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };
// // ─────────────────────────────────────────────────────────────────
// export default {
//   saveDraft,
//   submitPaper,
//   getMyExams,
//   getSubmittedPapers,
//   approvePaper,
//   rejectPaper,
// };
const QuestionPaper_modal_1 = __importDefault(require("../modals/QuestionPaper.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
class QuestionPaperService {
    // ─────────────────────────────────────────────
    // CREATE QUESTION PAPER
    // ─────────────────────────────────────────────
    static createQuestionPaper(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const { paperId, instituteId, examId, teacherId, paperSet, content, } = data;
            // 1. Validate Exam exists
            const exam = yield Exam_modal_1.default.findOne({
                where: { examId },
            });
            if (!exam) {
                throw new Error("Exam not found");
            }
            const resolvedInstituteId = instituteId || exam.instituteId;
            const resolvedTeacherId = teacherId || exam.teacherId;
            // 2. Ensure institute/teacher match exam when provided
            if (instituteId && exam.instituteId !== instituteId) {
                throw new Error("Institute mismatch with Exam");
            }
            if (teacherId && exam.teacherId !== teacherId) {
                throw new Error("Teacher mismatch with Exam");
            }
            // 3. Check duplicate paper set for same exam
            const existing = yield QuestionPaper_modal_1.default.findOne({
                where: {
                    examId,
                    paperSet,
                },
            });
            if (existing) {
                throw new Error(`Question Paper Set ${paperSet} already exists for this exam`);
            }
            const resolvedPaperId = (paperId === null || paperId === void 0 ? void 0 : paperId.trim()) || `QP-${helper_1.default.generateUserId()}`;
            const existingPaperId = yield QuestionPaper_modal_1.default.findOne({
                where: { paperId: resolvedPaperId },
            });
            if (existingPaperId) {
                throw new Error("Question paper ID already exists");
            }
            // 4. Create Question Paper
            const paper = yield QuestionPaper_modal_1.default.create({
                paperId: resolvedPaperId,
                instituteId: resolvedInstituteId,
                examId,
                teacherId: resolvedTeacherId,
                paperSet,
                content,
                status: "DRAFT",
            });
            return paper;
        });
    }
}
exports.QuestionPaperService = QuestionPaperService;
