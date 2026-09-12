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
exports.QuestionPaperService = exports.normalizePaperSet = exports.assertEditableStatus = exports.isTeacherUser = exports.EDITABLE_PACKAGE_STATUSES = void 0;
const QuestionPaper_modal_1 = __importDefault(require("../../modals/question-paper/QuestionPaper.modal"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const Notification_modal_1 = __importDefault(require("../../modals/Notification.modal"));
const helper_1 = __importDefault(require("../../utils/helper"));
const ApiError_1 = __importDefault(require("../../utils/ApiError"));
const sequelize_1 = require("../../config/sequelize");
const http_status_1 = __importDefault(require("http-status"));
const sequelize_2 = require("sequelize");
const exam_service_1 = require("../exam.service");
const uploadedFiles_service_1 = require("../uploadedFiles.service");
const answerSheetReconcile_1 = require("../../utils/answerSheetReconcile");
const logger_1 = __importDefault(require("../../config/logger"));
const PAPER_SETS = ["A", "B", "C", "D"];
// Papers/answer sheets can only be changed before review starts, or after a
// rejection — once pending/approved/published they are locked for the approval flow.
exports.EDITABLE_PACKAGE_STATUSES = ["DRAFT", "REJECTED"];
const STATUS_LABELS = {
    PENDING_APPROVAL: "pending approval",
    APPROVED: "approved",
    PUBLISHED: "published",
};
const isTeacherUser = (user) => { var _a, _b, _c; return String((_c = (_b = (_a = user === null || user === void 0 ? void 0 : user.role) === null || _a === void 0 ? void 0 : _a.role) !== null && _b !== void 0 ? _b : user === null || user === void 0 ? void 0 : user.role) !== null && _c !== void 0 ? _c : "").toUpperCase().includes("TEACH"); };
exports.isTeacherUser = isTeacherUser;
const assertEditableStatus = (status, what, action) => {
    var _a;
    if (!exports.EDITABLE_PACKAGE_STATUSES.includes(status)) {
        throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `This ${what} is ${(_a = STATUS_LABELS[status]) !== null && _a !== void 0 ? _a : status.toLowerCase()} and can no longer be ${action}. Only draft or rejected ${what}s can be ${action}.`);
    }
};
exports.assertEditableStatus = assertEditableStatus;
const normalizePaperSet = (value) => {
    var _a;
    const letter = (_a = String(value !== null && value !== void 0 ? value : "").trim().toUpperCase().match(/[A-D]$/)) === null || _a === void 0 ? void 0 : _a[0];
    return letter && PAPER_SETS.includes(letter) ? letter : null;
};
exports.normalizePaperSet = normalizePaperSet;
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
            // Deleting a paper deletes its answer sheet, so normally there is nothing here.
            // An answer sheet left over for this set from older data is linked to the new
            // paper (and its typed answers re-linked) instead of being silently ignored.
            const answerSheet = yield QuestionPaperService.relinkAnswerSheet(examId, paperSet, resolvedPaperId, content);
            yield (0, exam_service_1.markExamPaperCreated)(examId);
            return { paper, answerSheet };
        });
    }
    /**
     * Points a left-over answer sheet of the set (if any) at the set's new paper and
     * re-links its typed answers to the new questions (see answerSheetReconcile). The
     * new paper is a draft, so that answer sheet goes back to draft too — the set must
     * be reviewed again as a whole.
     */
    static relinkAnswerSheet(examId, paperSet, paperId, content) {
        var _a, _b, _c, _d;
        return __awaiter(this, void 0, void 0, function* () {
            try {
                const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
                const kept = yield QuestionPaperAnswer.findOne({
                    where: { examId, paperSet, paperId: { [sequelize_2.Op.ne]: paperId } },
                    order: [["updatedAt", "DESC"]],
                });
                if (!kept)
                    return null;
                const reconciled = (0, answerSheetReconcile_1.reconcileTypedAnswers)(kept.answers, null, content);
                const updates = { paperId };
                if (reconciled === null || reconciled === void 0 ? void 0 : reconciled.changed)
                    updates.answers = reconciled.answers;
                if (!exports.EDITABLE_PACKAGE_STATUSES.includes(kept.status)) {
                    Object.assign(updates, { status: "DRAFT", submittedAt: null, approvedAt: null, rejectedAt: null, publishedAt: null });
                }
                yield kept.update(updates);
                logger_1.default.info(`[QuestionPaper] Linked kept answer sheet ${kept.answerId} to new paper ${paperId} (Set ${paperSet}); ` +
                    `re-linked ${(_a = reconciled === null || reconciled === void 0 ? void 0 : reconciled.relinked) !== null && _a !== void 0 ? _a : 0}, unlinked ${(_b = reconciled === null || reconciled === void 0 ? void 0 : reconciled.unlinked) !== null && _b !== void 0 ? _b : 0}.`);
                return { answerId: kept.answerId, relinked: (_c = reconciled === null || reconciled === void 0 ? void 0 : reconciled.relinked) !== null && _c !== void 0 ? _c : 0, unlinked: (_d = reconciled === null || reconciled === void 0 ? void 0 : reconciled.unlinked) !== null && _d !== void 0 ? _d : 0 };
            }
            catch (err) {
                logger_1.default.warn(`[QuestionPaper] Could not link the kept answer sheet of Set ${paperSet}: ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
                return null;
            }
        });
    }
    /**
     * After the paper's questions changed: re-link the set's typed answers to the
     * current questions. Locked (pending / approved) answer sheets are left untouched.
     */
    static reconcileSetAnswers(paperId, oldContent, newContent) {
        return __awaiter(this, void 0, void 0, function* () {
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const answer = yield QuestionPaperAnswer.findOne({ where: { paperId } });
            if (!answer || !exports.EDITABLE_PACKAGE_STATUSES.includes(answer.status))
                return null;
            const reconciled = (0, answerSheetReconcile_1.reconcileTypedAnswers)(answer.answers, oldContent, newContent);
            if (!reconciled)
                return null;
            if (reconciled.changed)
                yield answer.update({ answers: reconciled.answers });
            return { answerId: answer.answerId, relinked: reconciled.relinked, unlinked: reconciled.unlinked };
        });
    }
    // ─────────────────────────────────────────────
    // FIND A PAPER THE USER MAY CHANGE
    // ─────────────────────────────────────────────
    static findPaperForUser(paperId, user) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaper_modal_1.default.findOne({ where: { paperId } });
            if (!paper || ((user === null || user === void 0 ? void 0 : user.instituteId) && paper.instituteId !== user.instituteId)) {
                throw new ApiError_1.default(http_status_1.default.NOT_FOUND, "Question paper not found");
            }
            if ((0, exports.isTeacherUser)(user) && paper.teacherId !== user.userId) {
                throw new ApiError_1.default(http_status_1.default.FORBIDDEN, "You can only change your own question paper");
            }
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // UPDATE QUESTION PAPER  (DRAFT / REJECTED only)
    // ─────────────────────────────────────────────
    static updateQuestionPaper(paperId, user, data) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaperService.findPaperForUser(paperId, user);
            (0, exports.assertEditableStatus)(paper.status, "question paper", "edited");
            const updates = {};
            if (data.content !== undefined) {
                if (!data.content || typeof data.content !== "object" || Array.isArray(data.content)) {
                    throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "content must be an object");
                }
                updates.content = data.content;
            }
            if (data.paperSet !== undefined) {
                const paperSet = (0, exports.normalizePaperSet)(data.paperSet);
                if (!paperSet) {
                    throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "paperSet must be one of A, B, C or D");
                }
                if (paperSet !== paper.paperSet) {
                    const clash = yield QuestionPaper_modal_1.default.findOne({
                        where: { examId: paper.examId, paperSet, paperId: { [sequelize_2.Op.ne]: paperId } },
                    });
                    if (clash) {
                        throw new ApiError_1.default(http_status_1.default.CONFLICT, `A question paper for Set ${paperSet} already exists for this exam. Please choose a different Set.`);
                    }
                    updates.paperSet = paperSet;
                }
            }
            if (Object.keys(updates).length === 0) {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "Nothing to update");
            }
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const oldContent = paper.content;
            const filesBefore = updates.content ? (0, uploadedFiles_service_1.collectUploadRefs)(oldContent) : [];
            yield sequelize_1.sequelize.transaction((transaction) => __awaiter(this, void 0, void 0, function* () {
                yield paper.update(updates, { transaction });
                // The answer sheet belongs to the paper's set — keep it on the same set.
                if (updates.paperSet) {
                    yield QuestionPaperAnswer.update({ paperSet: updates.paperSet }, { where: { paperId }, transaction });
                }
            }));
            // Questions may have been removed / re-added: keep the typed answers linked.
            const answerSheet = updates.content
                ? yield QuestionPaperService.reconcileSetAnswers(paperId, oldContent, updates.content)
                : null;
            // Diagrams / logo the teacher removed or replaced are no longer needed.
            (0, uploadedFiles_service_1.cleanupUploadsInBackground)(filesBefore, `editing question paper ${paperId}`);
            return { paper, answerSheet };
        });
    }
    // ─────────────────────────────────────────────
    // DELETE QUESTION PAPER — and its answer sheet
    // The answer sheet depends on the paper (its answers belong to the paper's
    // questions), so deleting a paper deletes the set's answer sheet with it, in one
    // transaction. Deleting an answer sheet on its own never touches the paper
    // (see QuestionPaperAnswerService.deleteQuestionPaperAnswer).
    // Both only while DRAFT / REJECTED; their uploaded files are removed afterwards.
    // ─────────────────────────────────────────────
    static deleteQuestionPaper(paperId, user) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaperService.findPaperForUser(paperId, user);
            (0, exports.assertEditableStatus)(paper.status, "question paper", "deleted");
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            // The set's answer sheet(s): linked by paper id, or by exam + set for older rows.
            const answerWhere = {
                [sequelize_2.Op.or]: [{ paperId }, { examId: paper.examId, paperSet: paper.paperSet }],
            };
            const answers = yield QuestionPaperAnswer.findAll({ where: answerWhere });
            // A locked (pending / approved) answer sheet blocks the whole delete — nothing is removed.
            answers.forEach((answer) => (0, exports.assertEditableStatus)(answer.status, "answer sheet", "deleted"));
            const uploadedFiles = [
                ...(0, uploadedFiles_service_1.collectUploadRefs)(paper.content),
                ...answers.flatMap((answer) => (0, uploadedFiles_service_1.collectUploadRefs)(answer.answers)),
            ];
            // Hard delete: the unique (exam, set) / (paper, set) indexes would otherwise keep
            // blocking a new paper or answer sheet for the same set after a soft delete.
            yield sequelize_1.sequelize.transaction((transaction) => __awaiter(this, void 0, void 0, function* () {
                yield QuestionPaperAnswer.destroy({ where: answerWhere, force: true, transaction });
                yield paper.destroy({ force: true, transaction });
            }));
            yield (0, exam_service_1.refreshExamStatus)(paper.examId);
            (0, uploadedFiles_service_1.cleanupUploadsInBackground)(uploadedFiles, `deleting question paper ${paperId}`);
            return {
                paperId,
                examId: paper.examId,
                paperSet: paper.paperSet,
                deletedAnswerSheets: answers.length,
            };
        });
    }
    // ─────────────────────────────────────────────
    // APPROVAL WORKFLOW — PER SET
    // A set = one exam's question paper + its answer sheet (same paperSet).
    // Each set is submitted / approved / rejected on its own; the exam status is
    // then recomputed from all of its sets (see refreshExamStatus).
    // ─────────────────────────────────────────────
    static requireSetLetter(paperSet) {
        const set = (0, exports.normalizePaperSet)(paperSet);
        if (!set)
            throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "paperSet must be one of A, B, C or D");
        return set;
    }
    /** The question paper and answer sheet of one set of an exam. */
    static findSet(examId, paperSet) {
        return __awaiter(this, void 0, void 0, function* () {
            const QuestionPaperAnswer = (yield Promise.resolve().then(() => __importStar(require("../../modals/question-paper/stander-answer.model")))).default;
            const paper = yield QuestionPaper_modal_1.default.findOne({ where: { examId, paperSet } });
            const answer = yield QuestionPaperAnswer.findOne({
                where: paper
                    ? { [sequelize_2.Op.or]: [{ paperId: paper.paperId }, { examId, paperSet }] }
                    : { examId, paperSet },
            });
            return { paper, answer };
        });
    }
    static assertSameInstitute(paper, user) {
        if ((user === null || user === void 0 ? void 0 : user.instituteId) && paper.instituteId !== user.instituteId) {
            throw new ApiError_1.default(http_status_1.default.NOT_FOUND, "Question paper not found");
        }
    }
    static notifyTeacher(paper, type, title, message) {
        return __awaiter(this, void 0, void 0, function* () {
            try {
                yield Notification_modal_1.default.create({
                    notificationId: yield helper_1.default.generateUserId(),
                    instituteId: paper.instituteId,
                    userId: paper.teacherId,
                    type,
                    title,
                    message,
                    referenceId: paper.paperId,
                });
            }
            catch (_) {
                // non-blocking
            }
        });
    }
    // SUBMIT ONE SET  (DRAFT / REJECTED → PENDING_APPROVAL)
    static submitSet(examId, paperSet, user) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const { paper, answer } = yield QuestionPaperService.findSet(examId, paperSet);
            if (!paper) {
                throw new ApiError_1.default(http_status_1.default.NOT_FOUND, `Question paper for Set ${paperSet} is missing. Please create it first.`);
            }
            QuestionPaperService.assertSameInstitute(paper, user);
            if ((0, exports.isTeacherUser)(user) && paper.teacherId !== user.userId) {
                throw new ApiError_1.default(http_status_1.default.FORBIDDEN, "You can only submit your own question paper");
            }
            if (!answer) {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `Standard answer sheet for Set ${paperSet} is missing. Please create it before submitting Set ${paperSet} for approval.`);
            }
            if (!exports.EDITABLE_PACKAGE_STATUSES.includes(paper.status) || !exports.EDITABLE_PACKAGE_STATUSES.includes(answer.status)) {
                const current = exports.EDITABLE_PACKAGE_STATUSES.includes(paper.status) ? answer.status : paper.status;
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `Set ${paperSet} is already ${(_a = STATUS_LABELS[current]) !== null && _a !== void 0 ? _a : current.toLowerCase()}. Only draft or rejected sets can be submitted.`);
            }
            // Never send a mismatched answer key for review.
            const unlinked = (0, answerSheetReconcile_1.countUnlinkedAnswers)(answer.answers, paper.content);
            if (unlinked > 0) {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `${unlinked} answer(s) in the Set ${paperSet} answer sheet are not linked to any question of the current paper. ` +
                    "Open the answer sheet to link or discard them before submitting.");
            }
            const now = new Date();
            yield sequelize_1.sequelize.transaction((transaction) => __awaiter(this, void 0, void 0, function* () {
                yield paper.update({ status: "PENDING_APPROVAL", submittedAt: now }, { transaction });
                yield answer.update({ status: "PENDING_APPROVAL", submittedAt: now, examId }, { transaction });
            }));
            yield (0, exam_service_1.refreshExamStatus)(examId);
            return { paperSet, paper, answer };
        });
    }
    // APPROVE ONE SET  (PENDING_APPROVAL → APPROVED)
    static approveSet(examId, paperSet, reviewer) {
        return __awaiter(this, void 0, void 0, function* () {
            const { paper, answer } = yield QuestionPaperService.findSet(examId, paperSet);
            if (!paper)
                throw new ApiError_1.default(http_status_1.default.NOT_FOUND, `Question paper for Set ${paperSet} not found`);
            QuestionPaperService.assertSameInstitute(paper, reviewer);
            if (paper.status !== "PENDING_APPROVAL") {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `Set ${paperSet} has not been submitted for approval (current status: ${paper.status}).`);
            }
            const now = new Date();
            yield sequelize_1.sequelize.transaction((transaction) => __awaiter(this, void 0, void 0, function* () {
                yield paper.update({ status: "APPROVED", approvedAt: now, rejectionNote: null }, { transaction });
                if (answer) {
                    yield answer.update({ status: "APPROVED", approvedAt: now, rejectionNote: null, examId }, { transaction });
                }
            }));
            yield QuestionPaperService.notifyTeacher(paper, "PAPER_APPROVED", "Question Paper Approved", `Your question paper and answer sheet for Set ${paperSet} have been approved.`);
            yield (0, exam_service_1.refreshExamStatus)(examId);
            return { paperSet, paper, answer };
        });
    }
    // REJECT ONE SET  (PENDING_APPROVAL → REJECTED)
    static rejectSet(examId, paperSet, reviewer, rejectionNote) {
        return __awaiter(this, void 0, void 0, function* () {
            const note = String(rejectionNote !== null && rejectionNote !== void 0 ? rejectionNote : "").trim();
            if (!note)
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "Rejection note is required");
            const { paper, answer } = yield QuestionPaperService.findSet(examId, paperSet);
            if (!paper)
                throw new ApiError_1.default(http_status_1.default.NOT_FOUND, `Question paper for Set ${paperSet} not found`);
            QuestionPaperService.assertSameInstitute(paper, reviewer);
            if (paper.status !== "PENDING_APPROVAL") {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `Set ${paperSet} has not been submitted for approval (current status: ${paper.status}).`);
            }
            const now = new Date();
            yield sequelize_1.sequelize.transaction((transaction) => __awaiter(this, void 0, void 0, function* () {
                yield paper.update({ status: "REJECTED", rejectedAt: now, rejectionNote: note }, { transaction });
                if (answer) {
                    yield answer.update({ status: "REJECTED", rejectedAt: now, rejectionNote: note }, { transaction });
                }
            }));
            yield QuestionPaperService.notifyTeacher(paper, "PAPER_REJECTED", "Question Paper Rejected", `Set ${paperSet} was rejected. Reason: ${note}`);
            yield (0, exam_service_1.refreshExamStatus)(examId);
            return { paperSet, paper, answer };
        });
    }
    // ── Exam-level endpoints (kept for existing callers) ────────────────────────
    // With a paperSet they act on that set only. Without one they act only on the
    // sets that qualify — never on a set that was not submitted.
    static submitExamForApproval(examId, user, paperSet) {
        return __awaiter(this, void 0, void 0, function* () {
            if (paperSet) {
                const result = yield QuestionPaperService.submitSet(examId, QuestionPaperService.requireSetLetter(paperSet), user);
                return { submitted: [result.paperSet], skipped: [] };
            }
            const papers = yield QuestionPaper_modal_1.default.findAll({ where: { examId }, order: [["paperSet", "ASC"]] });
            if (papers.length === 0) {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "Question Paper is missing! Please create the question paper before submitting for approval.");
            }
            const ready = [];
            const missingAnswer = [];
            for (const p of papers) {
                if (!exports.EDITABLE_PACKAGE_STATUSES.includes(p.status))
                    continue;
                const { answer } = yield QuestionPaperService.findSet(examId, p.paperSet);
                if (answer && exports.EDITABLE_PACKAGE_STATUSES.includes(answer.status))
                    ready.push(p.paperSet);
                else if (!answer)
                    missingAnswer.push(p.paperSet);
            }
            if (ready.length === 0) {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, missingAnswer.length
                    ? `Standard answer sheet is missing for Set ${missingAnswer.join(", ")}. Create it before submitting.`
                    : "No draft or rejected set of this exam is ready to submit.");
            }
            for (const set of ready) {
                yield QuestionPaperService.submitSet(examId, set, user);
            }
            return { submitted: ready, skipped: missingAnswer };
        });
    }
    static approveExamPair(examId, reviewer, paperSet) {
        return __awaiter(this, void 0, void 0, function* () {
            const sets = paperSet
                ? [QuestionPaperService.requireSetLetter(paperSet)]
                : (yield QuestionPaper_modal_1.default.findAll({ where: { examId, status: "PENDING_APPROVAL" } })).map((p) => p.paperSet);
            if (sets.length === 0) {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "No set of this exam is pending approval.");
            }
            for (const set of sets) {
                yield QuestionPaperService.approveSet(examId, set, reviewer);
            }
            return { approved: sets };
        });
    }
    static rejectExamPair(examId, reviewer, rejectionNote, paperSet) {
        return __awaiter(this, void 0, void 0, function* () {
            const sets = paperSet
                ? [QuestionPaperService.requireSetLetter(paperSet)]
                : (yield QuestionPaper_modal_1.default.findAll({ where: { examId, status: "PENDING_APPROVAL" } })).map((p) => p.paperSet);
            if (sets.length === 0) {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "No set of this exam is pending approval.");
            }
            for (const set of sets) {
                yield QuestionPaperService.rejectSet(examId, set, reviewer, rejectionNote);
            }
            return { rejected: sets };
        });
    }
    // ── Per-paper endpoints — act on the paper's set ───────────────────────────
    static getPaperOrFail(paperId) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaper_modal_1.default.findOne({ where: { paperId } });
            if (!paper)
                throw new ApiError_1.default(http_status_1.default.NOT_FOUND, "Question paper not found");
            return paper;
        });
    }
    static submitForApproval(paperId, user) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaperService.getPaperOrFail(paperId);
            const { paper: updated } = yield QuestionPaperService.submitSet(paper.examId, paper.paperSet, user);
            return updated;
        });
    }
    static approvePaper(paperId, reviewer) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaperService.getPaperOrFail(paperId);
            const { paper: updated } = yield QuestionPaperService.approveSet(paper.examId, paper.paperSet, reviewer);
            return updated;
        });
    }
    static rejectPaper(paperId, reviewer, rejectionNote) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaperService.getPaperOrFail(paperId);
            const { paper: updated } = yield QuestionPaperService.rejectSet(paper.examId, paper.paperSet, reviewer, rejectionNote);
            return updated;
        });
    }
    // PUBLISH  (APPROVED → PUBLISHED) — the set's answer sheet goes with it.
    static publishPaper(paperId) {
        return __awaiter(this, void 0, void 0, function* () {
            const paper = yield QuestionPaperService.getPaperOrFail(paperId);
            if (paper.status !== "APPROVED") {
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, `Cannot publish. Current status: ${paper.status}. Only APPROVED papers can be published.`);
            }
            const { answer } = yield QuestionPaperService.findSet(paper.examId, paper.paperSet);
            const now = new Date();
            yield paper.update({ status: "PUBLISHED", publishedAt: now });
            if (answer && answer.status === "APPROVED") {
                yield answer.update({ status: "PUBLISHED", publishedAt: now });
            }
            yield QuestionPaperService.notifyTeacher(paper, "PAPER_PUBLISHED", "Question Paper Published", "Your question paper has been published.");
            yield (0, exam_service_1.refreshExamStatus)(paper.examId);
            return paper;
        });
    }
    // ─────────────────────────────────────────────
    // LISTS
    // ─────────────────────────────────────────────
    static getPendingPapers(instituteId) {
        return __awaiter(this, void 0, void 0, function* () {
            return QuestionPaper_modal_1.default.findAll({
                where: { instituteId, status: "PENDING_APPROVAL" },
                order: [["submittedAt", "DESC"]],
            });
        });
    }
    static getPapers(instituteId, filters) {
        return __awaiter(this, void 0, void 0, function* () {
            const where = { instituteId };
            if (filters.status)
                where.status = filters.status;
            if (filters.examId)
                where.examId = filters.examId;
            if (filters.teacherId)
                where.teacherId = filters.teacherId;
            return QuestionPaper_modal_1.default.findAll({ where, order: [["createdAt", "DESC"]] });
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
                    ? { [sequelize_2.Op.or]: [{ examId }, { paperId: paper.paperId }] }
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
                    ? { [sequelize_2.Op.or]: [{ examId }, { paperId: paper.paperId }] }
                    : { examId },
            });
            if (!paper && !answer) {
                // Remarks are stored on the exam's paper/answer sheet. Creating a placeholder
                // paper here used to add a fake, rejected "Set A" to the exam.
                throw new ApiError_1.default(http_status_1.default.BAD_REQUEST, "Remarks can be added once a question paper or answer sheet exists for this exam.");
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
