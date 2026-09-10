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
const sequelize_1 = require("sequelize");
const exam_service_1 = require("../exam.service");
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
            yield (0, exam_service_1.markExamPaperCreated)(examId);
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
            if (paper.status !== "DRAFT" && paper.status !== "REJECTED") {
                throw new Error(`Cannot submit. Current status: ${paper.status}. Only DRAFT or REJECTED papers can be submitted for approval.`);
            }
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const matchingAnswer = yield QuestionPaperAnswer.findOne({
                where: { examId: paper.examId, paperSet: paper.paperSet },
            });
            if (!matchingAnswer) {
                throw new Error(`Cannot submit for approval: Standard Answer Sheet for Set ${paper.paperSet} is missing. Please create the standard answer sheet first.`);
            }
            yield paper.update({
                status: "PENDING_APPROVAL",
                submittedAt: new Date(),
            });
            // Also update the matching answer sheet to PENDING_APPROVAL if it's still in DRAFT
            if (matchingAnswer.status === "DRAFT" || matchingAnswer.status === "REJECTED") {
                yield matchingAnswer.update({
                    status: "PENDING_APPROVAL",
                    submittedAt: new Date(),
                });
            }
            yield (0, exam_service_1.setExamWorkflowStatus)(paper.examId, "Pending Approval");
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // SUBMIT EXAM PAIR FOR APPROVAL (BY EXAM ID)
    // ─────────────────────────────────────────────
    static submitExamForApproval(examId, teacherId) {
        return __awaiter(this, void 0, void 0, function* () {
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const paper = yield QuestionPaper_modal_1.default.findOne({
                where: { examId },
            });
            const answerWhere = paper
                ? { [sequelize_1.Op.or]: [{ examId }, { paperId: paper.paperId }] }
                : { examId };
            const answer = yield QuestionPaperAnswer.findOne({
                where: answerWhere,
            });
            if (!paper && !answer) {
                throw new Error("Neither Question Paper nor Standard Answer Sheet has been created for this exam.");
            }
            if (!paper) {
                throw new Error("Question Paper is missing! Please create the question paper before submitting for approval.");
            }
            if (!answer) {
                throw new Error("Standard Answer Sheet is missing! Please create the standard answer sheet before submitting for approval.");
            }
            const now = new Date();
            if (paper.status === "DRAFT" || paper.status === "REJECTED") {
                yield paper.update({
                    status: "PENDING_APPROVAL",
                    submittedAt: now,
                });
            }
            if (answer.status === "DRAFT" || answer.status === "REJECTED") {
                yield answer.update({
                    status: "PENDING_APPROVAL",
                    submittedAt: now,
                });
            }
            yield (0, exam_service_1.setExamWorkflowStatus)(examId, "Pending Approval");
            return { paper, answer };
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
            // Check if both QP and Answer are approved → set exam to Approved
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
            yield (0, exam_service_1.setExamWorkflowStatus)(paper.examId, "Rejected");
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
    // APPROVE EXAM PAIR (QP + ANSWER SHEET)
    // ─────────────────────────────────────────────
    static approveExamPair(examId, reviewerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const paper = yield QuestionPaper_modal_1.default.findOne({ where: { examId } });
            const answer = yield QuestionPaperAnswer.findOne({
                where: paper
                    ? { [sequelize_1.Op.or]: [{ examId }, { paperId: paper.paperId }] }
                    : { examId },
            });
            if (!paper && !answer) {
                throw new Error("No question paper or answer sheet found for this exam.");
            }
            const now = new Date();
            if (paper) {
                yield paper.update({
                    status: "APPROVED",
                    approvedAt: now,
                    rejectionNote: null,
                });
            }
            if (answer) {
                yield answer.update({
                    status: "APPROVED",
                    approvedAt: now,
                    rejectionNote: null,
                    examId,
                });
            }
            yield (0, exam_service_1.setExamWorkflowStatus)(examId, "Approved");
            return { paper, answer };
        });
    }
    // ─────────────────────────────────────────────
    // REJECT EXAM PAIR (QP + ANSWER SHEET)
    // ─────────────────────────────────────────────
    static rejectExamPair(examId, reviewerId, rejectionNote) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!rejectionNote || !rejectionNote.trim()) {
                throw new Error("Rejection note is required.");
            }
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const paper = yield QuestionPaper_modal_1.default.findOne({ where: { examId } });
            const answer = yield QuestionPaperAnswer.findOne({
                where: paper
                    ? { [sequelize_1.Op.or]: [{ examId }, { paperId: paper.paperId }] }
                    : { examId },
            });
            if (!paper && !answer) {
                throw new Error("No question paper or answer sheet found for this exam.");
            }
            const now = new Date();
            const note = rejectionNote.trim();
            if (paper) {
                yield paper.update({
                    status: "REJECTED",
                    rejectedAt: now,
                    rejectionNote: note,
                });
            }
            if (answer) {
                yield answer.update({
                    status: "REJECTED",
                    rejectedAt: now,
                    rejectionNote: note,
                });
            }
            yield (0, exam_service_1.setExamWorkflowStatus)(examId, "Rejected");
            return { paper, answer };
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
                    yield (0, exam_service_1.setExamWorkflowStatus)(examId, "Approved");
                }
            }
            catch (_) {
                // non-blocking — exam status update is best-effort
            }
        });
    }
    // ─────────────────────────────────────────────
    // GET EXAM REMARKS (CHAT HISTORY)
    // ─────────────────────────────────────────────
    static getExamRemarks(examId) {
        return __awaiter(this, void 0, void 0, function* () {
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const paper = yield QuestionPaper_modal_1.default.findOne({ where: { examId } });
            const answer = yield QuestionPaperAnswer.findOne({
                where: paper
                    ? { [sequelize_1.Op.or]: [{ examId }, { paperId: paper.paperId }] }
                    : { examId },
            });
            // Pick whichever has a rejectionNote
            const noteSource = (paper === null || paper === void 0 ? void 0 : paper.rejectionNote)
                ? paper.rejectionNote
                : (answer === null || answer === void 0 ? void 0 : answer.rejectionNote) || null;
            let remarks = [];
            if (noteSource) {
                try {
                    const parsed = JSON.parse(noteSource);
                    if (Array.isArray(parsed)) {
                        remarks = parsed;
                    }
                    else {
                        remarks = [
                            {
                                sender: "Admin Reviewer",
                                role: "ADMIN",
                                text: noteSource,
                                time: (paper === null || paper === void 0 ? void 0 : paper.rejectedAt) || (answer === null || answer === void 0 ? void 0 : answer.rejectedAt) || new Date().toISOString(),
                            },
                        ];
                    }
                }
                catch (_a) {
                    remarks = [
                        {
                            sender: "Admin Reviewer",
                            role: "ADMIN",
                            text: noteSource,
                            time: (paper === null || paper === void 0 ? void 0 : paper.rejectedAt) || (answer === null || answer === void 0 ? void 0 : answer.rejectedAt) || new Date().toISOString(),
                        },
                    ];
                }
            }
            return { remarks };
        });
    }
    // ─────────────────────────────────────────────
    // ADD EXAM REMARK (CHAT MESSAGE)
    // ─────────────────────────────────────────────
    static addExamRemark(examId, remark, senderRole = "ADMIN", senderName = "Admin Reviewer") {
        return __awaiter(this, void 0, void 0, function* () {
            if (!remark || !remark.trim()) {
                throw new Error("Remark text is required.");
            }
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            let paper = yield QuestionPaper_modal_1.default.findOne({ where: { examId } });
            let answer = yield QuestionPaperAnswer.findOne({
                where: paper
                    ? { [sequelize_1.Op.or]: [{ examId }, { paperId: paper.paperId }] }
                    : { examId },
            });
            if (!paper && !answer) {
                const exam = yield Exam_modal_1.default.findOne({ where: { examId } });
                const paperId = yield helper_1.default.generateUserId();
                paper = yield QuestionPaper_modal_1.default.create({
                    paperId,
                    instituteId: (exam === null || exam === void 0 ? void 0 : exam.instituteId) || "INST001",
                    examId,
                    teacherId: (exam === null || exam === void 0 ? void 0 : exam.teacherId) || "TECH001",
                    paperSet: "A",
                    content: {},
                    status: "REJECTED",
                });
            }
            // Parse existing remarks from whichever source has them
            const noteSource = (paper === null || paper === void 0 ? void 0 : paper.rejectionNote)
                ? paper.rejectionNote
                : (answer === null || answer === void 0 ? void 0 : answer.rejectionNote) || null;
            let remarks = [];
            if (noteSource) {
                try {
                    const parsed = JSON.parse(noteSource);
                    if (Array.isArray(parsed)) {
                        remarks = parsed;
                    }
                    else {
                        remarks = [
                            {
                                sender: "Admin Reviewer",
                                role: "ADMIN",
                                text: noteSource,
                                time: (paper === null || paper === void 0 ? void 0 : paper.rejectedAt) || (answer === null || answer === void 0 ? void 0 : answer.rejectedAt) || new Date().toISOString(),
                            },
                        ];
                    }
                }
                catch (_a) {
                    remarks = [
                        {
                            sender: "Admin Reviewer",
                            role: "ADMIN",
                            text: noteSource,
                            time: (paper === null || paper === void 0 ? void 0 : paper.rejectedAt) || (answer === null || answer === void 0 ? void 0 : answer.rejectedAt) || new Date().toISOString(),
                        },
                    ];
                }
            }
            // Append new remark
            remarks.push({
                sender: senderName,
                role: senderRole,
                text: remark.trim(),
                time: new Date().toISOString(),
            });
            const serialized = JSON.stringify(remarks);
            // Persist on both models if they exist
            if (paper) {
                yield paper.update({ rejectionNote: serialized });
            }
            if (answer) {
                yield answer.update({ rejectionNote: serialized });
            }
            return { remarks };
        });
    }
}
exports.QuestionPaperService = QuestionPaperService;
