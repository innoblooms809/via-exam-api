"use strict";
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
const http_status_1 = __importDefault(require("http-status"));
const sequelize_1 = require("sequelize");
const sequelize_2 = require("../config/sequelize");
const QuestionPaper_modal_1 = __importDefault(require("../modals/QuestionPaper.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const TeacherProfile_modal_1 = __importDefault(require("../modals/TeacherProfile.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
// ─────────────────────────────────────────────────────────────────
// Helper: summarise questions inside a paper for quick display
// ─────────────────────────────────────────────────────────────────
const summarisePaper = (content) => {
    var _a;
    const questions = (_a = content === null || content === void 0 ? void 0 : content.questions) !== null && _a !== void 0 ? _a : [];
    return {
        questionCount: questions.length,
        totalMarks: questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0),
        sections: questions.reduce((acc, q) => {
            acc[q.section] = (acc[q.section] || 0) + 1;
            return acc;
        }, {}),
    };
};
// ═════════════════════════════════════════════════════════════════
// 1. saveDraft
//    Teacher creates or updates a question paper draft
// ═════════════════════════════════════════════════════════════════
const saveDraft = (userId, instituteId, body) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examId, content } = body;
        // ── Verify exam exists, belongs to institute ─────────────────
        const exam = yield Exam_modal_1.default.findOne({
            where: {
                examId,
                instituteId,
                status: { [sequelize_1.Op.notIn]: ["Deleted"] },
            },
        });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found or does not belong to your institute.",
            };
        }
        // ── Only the assigned teacher can work on this exam ──────────
        if (exam.teacherId !== userId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "You are not assigned to this exam.",
            };
        }
        // ── Cannot edit once exam is Live or Completed ───────────────
        if (["Live", "Completed"].includes(exam.status)) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Cannot edit question paper. Exam is already ${exam.status}.`,
            };
        }
        // ── Check if a paper already exists for this exam + teacher ──
        const existing = yield QuestionPaper_modal_1.default.findOne({
            where: { examId, teacherId: userId },
        });
        if (existing) {
            // Cannot overwrite Submitted or Approved paper
            if (["Submitted", "Approved"].includes(existing.status)) {
                return {
                    error: true,
                    statusCode: http_status_1.default.BAD_REQUEST,
                    message: `Question paper is already ${existing.status}. Cannot save draft.`,
                };
            }
            // Update existing draft (or rejected paper being revised)
            yield existing.update({
                content,
                status: "Draft",
                rejectionNote: null,
            });
            return {
                error: false,
                statusCode: http_status_1.default.OK,
                message: "Draft updated successfully.",
                data: { paperId: existing.paperId, status: "Draft" },
            };
        }
        // ── Create brand new paper ───────────────────────────────────
        const paperId = yield helper_1.default.generateUserId();
        const paper = yield QuestionPaper_modal_1.default.create({
            paperId,
            examId,
            teacherId: userId,
            instituteId,
            content,
            status: "Draft",
            rejectionNote: null,
            submittedAt: null,
            approvedAt: null,
            rejectedAt: null,
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Question paper draft saved.",
            data: { paperId: paper.paperId, status: "Draft" },
        };
    }
    catch (e) {
        console.error("[saveDraft]", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ═════════════════════════════════════════════════════════════════
// 2. submitPaper
//    Teacher submits a Draft / Rejected paper for examiner review
// ═════════════════════════════════════════════════════════════════
const submitPaper = (userId, instituteId, paperId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const t = yield sequelize_2.sequelize.transaction();
    try {
        const paper = yield QuestionPaper_modal_1.default.findOne({
            where: { paperId },
            include: [
                {
                    model: Exam_modal_1.default,
                    as: "exam",
                    where: { instituteId },
                    attributes: ["examId", "status"],
                },
            ],
        });
        if (!paper) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Question paper not found.",
            };
        }
        // Only the author can submit
        if (paper.teacherId !== userId) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "You are not the author of this question paper.",
            };
        }
        if (!["Draft", "Rejected"].includes(paper.status)) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Cannot submit. Paper is currently ${paper.status}.`,
            };
        }
        // Must have at least one question
        const content = paper.content;
        if (!((_a = content === null || content === void 0 ? void 0 : content.questions) === null || _a === void 0 ? void 0 : _a.length)) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Cannot submit an empty question paper. Add at least one question.",
            };
        }
        // Update paper → Submitted
        yield paper.update({ status: "Submitted", rejectionNote: null, submittedAt: new Date() }, { transaction: t });
        // Update exam → Submitted (only if it was Draft)
        yield Exam_modal_1.default.update({ status: "Submitted" }, { where: { examId: paper.examId, status: "Draft" }, transaction: t });
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Question paper submitted for review.",
            data: { paperId, status: "Submitted" },
        };
    }
    catch (e) {
        yield t.rollback();
        console.error("[submitPaper]", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ═════════════════════════════════════════════════════════════════
// 3. getMyExams
//    Teacher views all exams assigned to them + paper status
// ═════════════════════════════════════════════════════════════════
const getMyExams = (userId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status, page = 1, limit = 10 } = query;
        const parsedPage = Math.max(1, parseInt(page));
        const parsedLimit = Math.max(1, parseInt(limit));
        const offset = (parsedPage - 1) * parsedLimit;
        // Build exam where clause
        const examWhere = {
            teacherId: userId,
            instituteId,
            status: { [sequelize_1.Op.notIn]: ["Deleted"] },
        };
        // Build paper where clause (for filtering by paper status)
        const paperWhere = {};
        if (status)
            paperWhere.status = status;
        const { count, rows } = yield Exam_modal_1.default.findAndCountAll({
            where: examWhere,
            include: [
                {
                    model: QuestionPaper_modal_1.default,
                    as: "questionPaper",
                    where: Object.keys(paperWhere).length ? paperWhere : undefined,
                    required: !!status,
                    attributes: [
                        "paperId",
                        "status",
                        "rejectionNote",
                        "submittedAt",
                        "updatedAt",
                        "content",
                    ],
                },
            ],
            order: [["createdAt", "DESC"]],
            limit: parsedLimit,
            offset,
            distinct: true,
        });
        const data = rows.map((exam) => {
            const paper = exam.questionPaper;
            let paperData = null;
            if (paper) {
                const summary = summarisePaper(paper.content);
                paperData = Object.assign({ paperId: paper.paperId, status: paper.status, rejectionNote: paper.rejectionNote || null, submittedAt: paper.submittedAt, lastUpdated: paper.updatedAt }, summary);
            }
            return {
                examId: exam.examId,
                session: exam.session,
                examType: exam.examType,
                class: exam.classVal,
                subject: exam.subject,
                examStatus: exam.status,
                examCreatedAt: exam.createdAt,
                paper: paperData, // null = teacher hasn't started yet
            };
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exams fetched successfully.",
            data: {
                exams: data,
                pagination: {
                    total: count,
                    page: parsedPage,
                    limit: parsedLimit,
                    totalPages: Math.ceil(count / parsedLimit),
                },
            },
        };
    }
    catch (e) {
        console.error("[getMyExams]", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ═════════════════════════════════════════════════════════════════
// 4. getSubmittedPapers
//    Examiner views all submitted papers pending review
// ═════════════════════════════════════════════════════════════════
const getSubmittedPapers = (instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { class: classFilter, subject, page = 1, limit = 10 } = query;
        const parsedPage = Math.max(1, parseInt(page));
        const parsedLimit = Math.max(1, parseInt(limit));
        const offset = (parsedPage - 1) * parsedLimit;
        // Exam-level filters
        const examWhere = {
            instituteId,
            status: { [sequelize_1.Op.notIn]: ["Deleted"] },
        };
        if (classFilter)
            examWhere.classVal = classFilter;
        if (subject)
            examWhere.subject = subject;
        const { count, rows } = yield QuestionPaper_modal_1.default.findAndCountAll({
            where: { status: "Submitted", instituteId },
            include: [
                {
                    model: Exam_modal_1.default,
                    as: "exam",
                    where: examWhere,
                    attributes: [
                        "examId",
                        "session",
                        "examType",
                        "classVal",
                        "subject",
                        "status",
                    ],
                },
                {
                    model: User_modal_1.default,
                    as: "teacher",
                    attributes: ["userId", "userName", "emailId"],
                    include: [
                        {
                            model: TeacherProfile_modal_1.default,
                            as: "teacherProfile",
                            attributes: ["employeeID", "specialization"],
                        },
                    ],
                },
            ],
            order: [["submittedAt", "ASC"]],
            limit: parsedLimit,
            offset,
            distinct: true,
        });
        const data = rows.map((paper) => {
            var _a, _b, _c, _d;
            return ({
                paperId: paper.paperId,
                examId: paper.examId,
                status: paper.status,
                submittedAt: paper.submittedAt,
                lastUpdated: paper.updatedAt,
                exam: {
                    session: paper.exam.session,
                    examType: paper.exam.examType,
                    class: paper.exam.classVal,
                    subject: paper.exam.subject,
                    examStatus: paper.exam.status,
                },
                teacher: {
                    teacherId: paper.teacher.userId,
                    name: paper.teacher.userName,
                    email: paper.teacher.emailId,
                    employeeId: (_b = (_a = paper.teacher.teacherProfile) === null || _a === void 0 ? void 0 : _a.employeeID) !== null && _b !== void 0 ? _b : null,
                    specialization: (_d = (_c = paper.teacher.teacherProfile) === null || _c === void 0 ? void 0 : _c.specialization) !== null && _d !== void 0 ? _d : null,
                },
                paperSummary: summarisePaper(paper.content),
            });
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Submitted papers fetched successfully.",
            data: {
                papers: data,
                pagination: {
                    total: count,
                    page: parsedPage,
                    limit: parsedLimit,
                    totalPages: Math.ceil(count / parsedLimit),
                },
            },
        };
    }
    catch (e) {
        console.error("[getSubmittedPapers]", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ═════════════════════════════════════════════════════════════════
// 5. approvePaper
//    Examiner approves → paper = Approved, exam = Live
// ═════════════════════════════════════════════════════════════════
const approvePaper = (instituteId, paperId) => __awaiter(void 0, void 0, void 0, function* () {
    const t = yield sequelize_2.sequelize.transaction();
    try {
        const paper = yield QuestionPaper_modal_1.default.findOne({
            where: { paperId },
            include: [
                {
                    model: Exam_modal_1.default,
                    as: "exam",
                    where: { instituteId },
                    attributes: ["examId", "status"],
                },
            ],
        });
        if (!paper) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Question paper not found.",
            };
        }
        if (paper.status !== "Submitted") {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Cannot approve. Paper status is '${paper.status}'. Only Submitted papers can be approved.`,
            };
        }
        // Paper → Approved
        yield paper.update({ status: "Approved", rejectionNote: null, approvedAt: new Date() }, { transaction: t });
        // Exam → Live
        yield Exam_modal_1.default.update({ status: "Live" }, { where: { examId: paper.examId }, transaction: t });
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Question paper approved. Exam is now Live.",
            data: {
                paperId,
                paperStatus: "Approved",
                examId: paper.examId,
                examStatus: "Live",
            },
        };
    }
    catch (e) {
        yield t.rollback();
        console.error("[approvePaper]", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ═════════════════════════════════════════════════════════════════
// 6. rejectPaper
//    Examiner rejects → paper = Rejected (with note), exam = Draft
// ═════════════════════════════════════════════════════════════════
const rejectPaper = (instituteId, paperId, rejectionNote) => __awaiter(void 0, void 0, void 0, function* () {
    const t = yield sequelize_2.sequelize.transaction();
    try {
        if (!(rejectionNote === null || rejectionNote === void 0 ? void 0 : rejectionNote.trim())) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "rejectionNote is required when rejecting a paper.",
            };
        }
        const paper = yield QuestionPaper_modal_1.default.findOne({
            where: { paperId },
            include: [
                {
                    model: Exam_modal_1.default,
                    as: "exam",
                    where: { instituteId },
                    attributes: ["examId", "status"],
                },
            ],
        });
        if (!paper) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Question paper not found.",
            };
        }
        if (paper.status !== "Submitted") {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Cannot reject. Paper status is '${paper.status}'. Only Submitted papers can be rejected.`,
            };
        }
        const note = rejectionNote.trim();
        // Paper → Rejected
        yield paper.update({ status: "Rejected", rejectionNote: note, rejectedAt: new Date() }, { transaction: t });
        // Exam → back to Draft
        yield Exam_modal_1.default.update({ status: "Draft" }, { where: { examId: paper.examId, status: "Submitted" }, transaction: t });
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Question paper rejected. Teacher will be notified to revise.",
            data: {
                paperId,
                paperStatus: "Rejected",
                examId: paper.examId,
                examStatus: "Draft",
                rejectionNote: note,
            },
        };
    }
    catch (e) {
        yield t.rollback();
        console.error("[rejectPaper]", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─────────────────────────────────────────────────────────────────
exports.default = {
    saveDraft,
    submitPaper,
    getMyExams,
    getSubmittedPapers,
    approvePaper,
    rejectPaper,
};
