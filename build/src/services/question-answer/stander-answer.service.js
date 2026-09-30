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
const Notification_modal_1 = __importDefault(require("../../modals/Notification.modal"));
const helper_1 = __importDefault(require("../../utils/helper"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const http_status_1 = __importDefault(require("http-status"));
const exam_service_1 = require("../exam.service");
const questionPaper_service_1 = require("./questionPaper.service");
const uploadedFiles_service_1 = require("../uploadedFiles.service");
const answerSheetReconcile_1 = require("../../utils/answerSheetReconcile");
/**
 * Stores on every typed answer which question it answers (text, marks, number), so
 * the answers can be re-linked if the paper is later rebuilt or edited
 * (see utils/answerSheetReconcile). Uploaded-PDF answer sheets pass through as-is.
 */
function withQuestionSnapshots(answers, paperId) {
    return __awaiter(this, void 0, void 0, function* () {
        const paper = paperId ? yield QuestionPaper_modal_1.default.findOne({ where: { paperId } }) : null;
        const stamped = paper ? (0, answerSheetReconcile_1.reconcileTypedAnswers)(answers, paper.content, null) : null;
        return (stamped ? stamped.answers : answers);
    });
}
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
                    answers: yield withQuestionSnapshots(data.answers, data.paperId),
                    status: data.status || "DRAFT",
                });
                if (data.examId) {
                    yield (0, exam_service_1.markExamPaperCreated)(data.examId);
                }
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
                // The set's answer sheet: linked to this paper, or kept from a deleted paper of the same set.
                const existing = (yield stander_answer_model_1.default.findOne({
                    where: {
                        paperId: data.paperId,
                        paperSet: data.paperSet,
                    },
                })) || (yield stander_answer_model_1.default.findOne({
                    where: { examId: data.examId, paperSet: data.paperSet },
                    order: [["updatedAt", "DESC"]],
                }));
                if (existing) {
                    (0, questionPaper_service_1.assertEditableStatus)(existing.status, "answer sheet", "replaced");
                    const filesBefore = (0, uploadedFiles_service_1.collectUploadRefs)(existing.answers);
                    yield existing.update({
                        paperId: data.paperId,
                        answers: { pdfUrl: data.pdfUrl },
                        teacherId: data.teacherId,
                        instituteId: data.instituteId,
                        examId: data.examId,
                    });
                    // The replaced PDF (and any old answer diagrams) are no longer used.
                    (0, uploadedFiles_service_1.cleanupUploadsInBackground)(filesBefore, `replacing answer sheet ${existing.answerId}`);
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
                    yield (0, exam_service_1.markExamPaperCreated)(data.examId);
                    return result;
                }
            }
            catch (error) {
                if (error instanceof ApiError_1.default)
                    throw error;
                throw new Error(error.message);
            }
        });
    }
    // ─────────────────────────────────────────────
    // FIND AN ANSWER SHEET THE USER MAY CHANGE
    // ─────────────────────────────────────────────
    static findAnswerForUser(answerId, user) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield stander_answer_model_1.default.findOne({ where: { answerId } });
            if (!answer || ((user === null || user === void 0 ? void 0 : user.instituteId) && answer.instituteId !== user.instituteId)) {
                throw new ApiError_1.default(http_status_1.default.NOT_FOUND, "Answer sheet not found");
            }
            if ((0, questionPaper_service_1.isTeacherUser)(user) && answer.teacherId !== user.userId) {
                // Older answer sheets were saved under a fixed teacher id, so also accept
                // the teacher who owns the matching question paper.
                const paper = yield QuestionPaper_modal_1.default.findOne({ where: { paperId: answer.paperId } });
                if (!paper || paper.teacherId !== user.userId) {
                    throw new ApiError_1.default(http_status_1.default.FORBIDDEN, "You can only change your own answer sheet");
                }
            }
            return answer;
        });
    }
    // Throws before anything is uploaded when an existing answer sheet is locked.
    static assertReplaceable(paperId, paperSet, examId) {
        return __awaiter(this, void 0, void 0, function* () {
            const existing = (yield stander_answer_model_1.default.findOne({ where: { paperId, paperSet } })) ||
                (examId
                    ? yield stander_answer_model_1.default.findOne({ where: { examId, paperSet: paperSet }, order: [["updatedAt", "DESC"]] })
                    : null);
            if (existing)
                (0, questionPaper_service_1.assertEditableStatus)(existing.status, "answer sheet", "replaced");
        });
    }
    // ─────────────────────────────────────────────
    // UPDATE ANSWER SHEET  (DRAFT / REJECTED only)
    // ─────────────────────────────────────────────
    static updateQuestionPaperAnswer(answerId, user, answers) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!answers || typeof answers !== "object") {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "answers must be an array or object");
            }
            const answer = yield QuestionPaperAnswerService.findAnswerForUser(answerId, user);
            (0, questionPaper_service_1.assertEditableStatus)(answer.status, "answer sheet", "edited");
            const filesBefore = (0, uploadedFiles_service_1.collectUploadRefs)(answer.answers);
            yield answer.update({ answers: yield withQuestionSnapshots(answers, answer.paperId) });
            // A replaced uploaded PDF / removed answer diagrams are no longer used.
            (0, uploadedFiles_service_1.cleanupUploadsInBackground)(filesBefore, `editing answer sheet ${answerId}`);
            return answer;
        });
    }
    // ─────────────────────────────────────────────
    // DELETE ANSWER SHEET  (DRAFT / REJECTED only)
    // Independent of the question paper: the paper is never touched. The uploaded
    // PDF / answer diagrams of this answer sheet are removed with it.
    // ─────────────────────────────────────────────
    static deleteQuestionPaperAnswer(answerId, user) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield QuestionPaperAnswerService.findAnswerForUser(answerId, user);
            (0, questionPaper_service_1.assertEditableStatus)(answer.status, "answer sheet", "deleted");
            const uploadedFiles = (0, uploadedFiles_service_1.collectUploadRefs)(answer.answers);
            // Hard delete so a new answer sheet can be created for the same set.
            yield answer.destroy({ force: true });
            yield (0, exam_service_1.refreshExamStatus)(answer.examId);
            (0, uploadedFiles_service_1.cleanupUploadsInBackground)(uploadedFiles, `deleting answer sheet ${answerId}`);
            return { answerId, examId: answer.examId, paperSet: answer.paperSet };
        });
    }
    // ─────────────────────────────────────────────
    // APPROVAL — an answer sheet is reviewed together with its set's question
    // paper, so these delegate to the per-set workflow of that set only.
    // ─────────────────────────────────────────────
    static getAnswerOrFail(answerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield stander_answer_model_1.default.findOne({ where: { answerId } });
            if (!answer)
                throw new ApiError_1.default(http_status_1.default.NOT_FOUND, "Answer sheet not found");
            return answer;
        });
    }
    static submitForApproval(answerId, user) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield QuestionPaperAnswerService.getAnswerOrFail(answerId);
            yield questionPaper_service_1.QuestionPaperService.submitSet(answer.examId, answer.paperSet, user);
            return answer.reload();
        });
    }
    static approveAnswer(answerId, reviewer) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield QuestionPaperAnswerService.getAnswerOrFail(answerId);
            yield questionPaper_service_1.QuestionPaperService.approveSet(answer.examId, answer.paperSet, reviewer);
            return answer.reload();
        });
    }
    static rejectAnswer(answerId, reviewer, rejectionNote) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield QuestionPaperAnswerService.getAnswerOrFail(answerId);
            yield questionPaper_service_1.QuestionPaperService.rejectSet(answer.examId, answer.paperSet, reviewer, rejectionNote);
            return answer.reload();
        });
    }
    // PUBLISH  (APPROVED → PUBLISHED)
    static publishAnswer(answerId) {
        return __awaiter(this, void 0, void 0, function* () {
            const answer = yield QuestionPaperAnswerService.getAnswerOrFail(answerId);
            if (answer.status !== "APPROVED") {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `Cannot publish. Current status: ${answer.status}. Only APPROVED answer sheets can be published.`);
            }
            yield answer.update({ status: "PUBLISHED", publishedAt: new Date() });
            try {
                yield Notification_modal_1.default.create({
                    notificationId: yield helper_1.default.generateUserId(),
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
}
exports.default = QuestionPaperAnswerService;
