"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
const QuestionPaper_modal_1 = __importDefault(require("../../modals/question-paper/QuestionPaper.modal"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const Notification_modal_1 = __importDefault(require("../../modals/Notification.modal"));
const helper_1 = __importDefault(require("../../utils/helper"));
class QuestionPaperService {
    // ─────────────────────────────────────────────
    // CREATE QUESTION PAPER
    // ─────────────────────────────────────────────
    static createQuestionPaper(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const { instituteId, examId, teacherId, paperSet, content, } = data;
            if (!teacherId) {
                throw new Error("teacherId is required");
            }
            const exam = yield Exam_modal_1.default.findOne({
                where: { examId },
            });
            if (!exam) {
                throw new Error("Exam not found");
            }
            const resolvedInstituteId = instituteId || exam.instituteId;
            const existing = yield QuestionPaper_modal_1.default.findOne({
                where: { examId, paperSet },
            });
            if (existing) {
                throw new Error(`Question Paper Set ${paperSet} already exists for this exam`);
            }
            const resolvedPaperId = yield helper_1.default.generateUserId();
            const paper = yield QuestionPaper_modal_1.default.create({
                paperId: resolvedPaperId,
                instituteId: resolvedInstituteId,
                examId,
                teacherId,
                paperSet,
                content,
                status: "DRAFT",
            });
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // SUBMIT FOR APPROVAL  (DRAFT → PENDING_APPROVAL)
    // ─────────────────────────────────────────────
    static submitForApproval(paperId, teacherId) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaper_modal_1.default.findOne({
                where: { paperId },
            });
            if (!paper) {
                throw new Error("Question paper not found");
            }
            if (paper.teacherId !== teacherId) {
                throw new Error("You can only submit your own question paper");
            }
            if (paper.status !== "DRAFT") {
                throw new Error(`Cannot submit. Current status: ${paper.status}. Only DRAFT papers can be submitted.`);
            }
            yield paper.update({
                status: "PENDING_APPROVAL",
                submittedAt: new Date(),
            });
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // APPROVE  (PENDING_APPROVAL → APPROVED)
    // ─────────────────────────────────────────────
    static approvePaper(paperId, reviewerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaper_modal_1.default.findOne({
                where: { paperId },
            });
            if (!paper) {
                throw new Error("Question paper not found");
            }
            if (paper.status !== "PENDING_APPROVAL") {
                throw new Error(`Cannot approve. Current status: ${paper.status}. Only PENDING_APPROVAL papers can be approved.`);
            }
            yield paper.update({
                status: "APPROVED",
                approvedAt: new Date(),
                rejectionNote: null,
            });
            // Notify the teacher
            const notificationId = yield helper_1.default.generateUserId();
            try {
                yield Notification_modal_1.default.create({
                    notificationId,
                    instituteId: paper.instituteId,
                    userId: paper.teacherId,
                    type: "PAPER_APPROVED",
                    title: "Question Paper Approved",
                    message: "Your question paper has been approved.",
                    referenceId: paperId,
                });
            }
            catch (_) {
                // non-blocking
            }
            // Check if both QP and Answer are approved → set exam to Live
            yield QuestionPaperService.checkAndSetExamLive(paper.examId);
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // REJECT  (PENDING_APPROVAL → REJECTED)
    // ─────────────────────────────────────────────
    static rejectPaper(paperId, reviewerId, rejectionNote) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!rejectionNote || !rejectionNote.trim()) {
                throw new Error("Rejection note is required");
            }
            const paper = yield QuestionPaper_modal_1.default.findOne({
                where: { paperId },
            });
            if (!paper) {
                throw new Error("Question paper not found");
            }
            if (paper.status !== "PENDING_APPROVAL") {
                throw new Error(`Cannot reject. Current status: ${paper.status}. Only PENDING_APPROVAL papers can be rejected.`);
            }
            yield paper.update({
                status: "REJECTED",
                rejectedAt: new Date(),
                rejectionNote: rejectionNote.trim(),
            });
            // Notify the teacher
            const notificationId = yield helper_1.default.generateUserId();
            try {
                yield Notification_modal_1.default.create({
                    notificationId,
                    instituteId: paper.instituteId,
                    userId: paper.teacherId,
                    type: "PAPER_REJECTED",
                    title: "Question Paper Rejected",
                    message: `Your question paper has been rejected. Reason: ${rejectionNote.trim()}`,
                    referenceId: paperId,
                });
            }
            catch (_) {
                // non-blocking
            }
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // PUBLISH  (APPROVED → PUBLISHED)
    // ─────────────────────────────────────────────
    static publishPaper(paperId) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaper_modal_1.default.findOne({
                where: { paperId },
            });
            if (!paper) {
                throw new Error("Question paper not found");
            }
            if (paper.status !== "APPROVED") {
                throw new Error(`Cannot publish. Current status: ${paper.status}. Only APPROVED papers can be published.`);
            }
            yield paper.update({
                status: "PUBLISHED",
                publishedAt: new Date(),
            });
            // Notify the teacher
            const notificationId = yield helper_1.default.generateUserId();
            try {
                yield Notification_modal_1.default.create({
                    notificationId,
                    instituteId: paper.instituteId,
                    userId: paper.teacherId,
                    type: "PAPER_PUBLISHED",
                    title: "Question Paper Published",
                    message: "Your question paper has been published.",
                    referenceId: paperId,
                });
            }
            catch (_) {
                // non-blocking
            }
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // GET PENDING PAPERS
    // ─────────────────────────────────────────────
    static getPendingPapers(instituteId) {
        return __awaiter(this, void 0, void 0, function* () {
            const papers = yield QuestionPaper_modal_1.default.findAll({
                where: {
                    instituteId,
                    status: "PENDING_APPROVAL",
                },
                order: [["submittedAt", "DESC"]],
            });
            return papers;
        });
    }
    // ─────────────────────────────────────────────
    // GET ALL PAPERS WITH FILTERS
    // ─────────────────────────────────────────────
    static getPapers(instituteId, filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const where = { instituteId };
            if (filters.status)
                where.status = filters.status;
            if (filters.examId)
                where.examId = filters.examId;
            if (filters.teacherId)
                where.teacherId = filters.teacherId;
            const papers = yield QuestionPaper_modal_1.default.findAll({
                where,
                order: [["createdAt", "DESC"]],
            });
            return papers;
        });
    }
    // ─────────────────────────────────────────────
    // CHECK AND SET EXAM LIVE
    // ─────────────────────────────────────────────
    static checkAndSetExamLive(examId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
                const [qp, ans] = yield Promise.all([
                    QuestionPaper_modal_1.default.findOne({ where: { examId, status: "APPROVED" } }),
                    QuestionPaperAnswer.findOne({ where: { examId, status: "APPROVED" } }),
                ]);
                if (qp && ans) {
                    yield Exam_modal_1.default.update({ status: "Live" }, { where: { examId } });
                }
            }
            catch (_) {
                // non-blocking — exam status update is best-effort
            }
        });
    }
}
exports.QuestionPaperService = QuestionPaperService;
