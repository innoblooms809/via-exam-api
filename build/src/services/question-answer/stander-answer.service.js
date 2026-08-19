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
const stander_answer_model_1 = __importDefault(require("../../modals/question-paper/stander-answer.model"));
const QuestionPaper_modal_1 = __importDefault(require("../../modals/question-paper/QuestionPaper.modal"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const Notification_modal_1 = __importDefault(require("../../modals/Notification.modal"));
const helper_1 = __importDefault(require("../../utils/helper"));
class QuestionPaperAnswerService {
    // ─────────────────────────────────────────────
    // CREATE ANSWER KEY
    // ─────────────────────────────────────────────
    static createQuestionPaperAnswer(data) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const existing = yield stander_answer_model_1.default.findOne({
                    where: {
                        paperId: data.paperId,
                        paperSet: data.paperSet,
                    },
                });
                if (existing) {
                    throw new Error("Answer key already exists for this paper set");
                }
                const answerId = yield helper_1.default.generateUserId();
                const result = yield stander_answer_model_1.default.create({
                    answerId,
                    instituteId: data.instituteId,
                    paperId: data.paperId,
                    examId: data.examId,
                    teacherId: data.teacherId,
                    paperSet: data.paperSet,
                    answers: data.answers,
                    status: data.status || "DRAFT",
                });
                return result;
            }
            catch (error) {
                throw new Error(error.message);
            }
        });
    }
    // ─────────────────────────────────────────────
    // SAVE ANSWER SHEET PDF URL
    // ─────────────────────────────────────────────
    static saveAnswerSheetPdfUrl(data) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const existing = yield stander_answer_model_1.default.findOne({
                    where: {
                        paperId: data.paperId,
                        paperSet: data.paperSet,
                    },
                });
                if (existing) {
                    yield existing.update({
                        answers: { pdfUrl: data.pdfUrl },
                        teacherId: data.teacherId,
                        instituteId: data.instituteId,
                        examId: data.examId,
                    });
                    return existing;
                }
                else {
                    const answerId = yield helper_1.default.generateUserId();
                    const result = yield stander_answer_model_1.default.create({
                        answerId,
                        instituteId: data.instituteId,
                        paperId: data.paperId,
                        examId: data.examId,
                        teacherId: data.teacherId,
                        paperSet: data.paperSet,
                        answers: { pdfUrl: data.pdfUrl },
                        status: "DRAFT",
                    });
                    return result;
                }
            }
            catch (error) {
                throw new Error(error.message);
            }
        });
    }
    // ─────────────────────────────────────────────
    // SUBMIT FOR APPROVAL  (DRAFT → PENDING_APPROVAL)
    // ─────────────────────────────────────────────
    static submitForApproval(answerId, teacherId) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield stander_answer_model_1.default.findOne({
                where: { answerId },
            });
            if (!answer) {
                throw new Error("Answer sheet not found");
            }
            if (answer.teacherId !== teacherId) {
                throw new Error("You can only submit your own answer sheet");
            }
            if (answer.status !== "DRAFT") {
                throw new Error(`Cannot submit. Current status: ${answer.status}. Only DRAFT answer sheets can be submitted.`);
            }
            yield answer.update({
                status: "PENDING_APPROVAL",
                submittedAt: new Date(),
            });
            return answer;
        });
    }
    // ─────────────────────────────────────────────
    // APPROVE  (PENDING_APPROVAL → APPROVED)
    // ─────────────────────────────────────────────
    static approveAnswer(answerId, reviewerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield stander_answer_model_1.default.findOne({
                where: { answerId },
            });
            if (!answer) {
                throw new Error("Answer sheet not found");
            }
            if (answer.status !== "PENDING_APPROVAL") {
                throw new Error(`Cannot approve. Current status: ${answer.status}. Only PENDING_APPROVAL answer sheets can be approved.`);
            }
            yield answer.update({
                status: "APPROVED",
                approvedAt: new Date(),
                rejectionNote: null,
            });
            // Notify the teacher
            const notificationId = yield helper_1.default.generateUserId();
            try {
                yield Notification_modal_1.default.create({
                    notificationId,
                    instituteId: answer.instituteId,
                    userId: answer.teacherId,
                    type: "ANSWER_APPROVED",
                    title: "Answer Sheet Approved",
                    message: "Your answer sheet has been approved.",
                    referenceId: answerId,
                });
            }
            catch (_) {
                // non-blocking
            }
            // Check if both QP and Answer are approved → set exam to Live
            yield QuestionPaperAnswerService.checkAndSetExamLive(answer.examId);
            return answer;
        });
    }
    // ─────────────────────────────────────────────
    // REJECT  (PENDING_APPROVAL → REJECTED)
    // ─────────────────────────────────────────────
    static rejectAnswer(answerId, reviewerId, rejectionNote) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!rejectionNote || !rejectionNote.trim()) {
                throw new Error("Rejection note is required");
            }
            const answer = yield stander_answer_model_1.default.findOne({
                where: { answerId },
            });
            if (!answer) {
                throw new Error("Answer sheet not found");
            }
            if (answer.status !== "PENDING_APPROVAL") {
                throw new Error(`Cannot reject. Current status: ${answer.status}. Only PENDING_APPROVAL answer sheets can be rejected.`);
            }
            yield answer.update({
                status: "REJECTED",
                rejectedAt: new Date(),
                rejectionNote: rejectionNote.trim(),
            });
            // Notify the teacher
            const notificationId = yield helper_1.default.generateUserId();
            try {
                yield Notification_modal_1.default.create({
                    notificationId,
                    instituteId: answer.instituteId,
                    userId: answer.teacherId,
                    type: "ANSWER_REJECTED",
                    title: "Answer Sheet Rejected",
                    message: `Your answer sheet has been rejected. Reason: ${rejectionNote.trim()}`,
                    referenceId: answerId,
                });
            }
            catch (_) {
                // non-blocking
            }
            return answer;
        });
    }
    // ─────────────────────────────────────────────
    // PUBLISH  (APPROVED → PUBLISHED)
    // ─────────────────────────────────────────────
    static publishAnswer(answerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield stander_answer_model_1.default.findOne({
                where: { answerId },
            });
            if (!answer) {
                throw new Error("Answer sheet not found");
            }
            if (answer.status !== "APPROVED") {
                throw new Error(`Cannot publish. Current status: ${answer.status}. Only APPROVED answer sheets can be published.`);
            }
            yield answer.update({
                status: "PUBLISHED",
                publishedAt: new Date(),
            });
            // Notify the teacher
            const notificationId = yield helper_1.default.generateUserId();
            try {
                yield Notification_modal_1.default.create({
                    notificationId,
                    instituteId: answer.instituteId,
                    userId: answer.teacherId,
                    type: "ANSWER_PUBLISHED",
                    title: "Answer Sheet Published",
                    message: "Your answer sheet has been published.",
                    referenceId: answerId,
                });
            }
            catch (_) {
                // non-blocking
            }
            return answer;
        });
    }
    // ─────────────────────────────────────────────
    // GET PENDING ANSWER SHEETS
    // ─────────────────────────────────────────────
    static getPendingAnswers(instituteId) {
        return __awaiter(this, void 0, void 0, function* () {
            const answers = yield stander_answer_model_1.default.findAll({
                where: {
                    instituteId,
                    status: "PENDING_APPROVAL",
                },
                order: [["submittedAt", "DESC"]],
            });
            return answers;
        });
    }
    // ─────────────────────────────────────────────
    // GET ALL ANSWER SHEETS WITH FILTERS
    // ─────────────────────────────────────────────
    static getAnswers(instituteId, filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const where = { instituteId };
            if (filters.status)
                where.status = filters.status;
            if (filters.examId)
                where.examId = filters.examId;
            if (filters.teacherId)
                where.teacherId = filters.teacherId;
            const answers = yield stander_answer_model_1.default.findAll({
                where,
                order: [["createdAt", "DESC"]],
            });
            return answers;
        });
    }
    // ─────────────────────────────────────────────
    // CHECK AND SET EXAM LIVE
    // ─────────────────────────────────────────────
    static checkAndSetExamLive(examId) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const [qp, ans] = yield Promise.all([
                    QuestionPaper_modal_1.default.findOne({ where: { examId, status: "APPROVED" } }),
                    stander_answer_model_1.default.findOne({ where: { examId, status: "APPROVED" } }),
                ]);
                if (qp && ans) {
                    yield Exam_modal_1.default.update({ status: "Live" }, { where: { examId } });
                }
            }
            catch (_) {
                // non-blocking
            }
        });
    }
}
exports.default = QuestionPaperAnswerService;
