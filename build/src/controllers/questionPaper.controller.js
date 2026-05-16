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
const questionPaper_service_1 = __importDefault(require("../services/questionPaper.service"));
// ═════════════════════════════════════════════════════════════════
// 1. POST /v1/question-papers
//    Teacher saves a question paper as Draft
// ═════════════════════════════════════════════════════════════════
const saveDraft = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, instituteId } = req.user;
        const { examId, content } = req.body;
        if (!examId || !content) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "examId and content are required.",
            });
        }
        const result = yield questionPaper_service_1.default.saveDraft(userId, instituteId, {
            examId,
            content,
        });
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ═════════════════════════════════════════════════════════════════
// 2. PATCH /v1/question-papers/:paperId/submit
//    Teacher submits paper for examiner review
// ═════════════════════════════════════════════════════════════════
const submitPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, instituteId } = req.user;
        const { paperId } = req.params;
        const result = yield questionPaper_service_1.default.submitPaper(userId, instituteId, paperId);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ═════════════════════════════════════════════════════════════════
// 3. GET /v1/question-papers/teacher/my-exams
//    Teacher views all assigned exams + paper status
// ═════════════════════════════════════════════════════════════════
const getMyExams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId, instituteId } = req.user;
        const result = yield questionPaper_service_1.default.getMyExams(userId, instituteId, req.query);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ═════════════════════════════════════════════════════════════════
// 4. GET /v1/question-papers/submitted
//    Examiner views all submitted papers pending review
// ═════════════════════════════════════════════════════════════════
const getSubmittedPapers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { instituteId } = req.user;
        const result = yield questionPaper_service_1.default.getSubmittedPapers(instituteId, req.query);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ═════════════════════════════════════════════════════════════════
// 5. PATCH /v1/question-papers/:paperId/approve
//    Examiner approves → paper = Approved, exam = Live
// ═════════════════════════════════════════════════════════════════
const approvePaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { instituteId } = req.user;
        const { paperId } = req.params;
        const result = yield questionPaper_service_1.default.approvePaper(instituteId, paperId);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ═════════════════════════════════════════════════════════════════
// 6. PATCH /v1/question-papers/:paperId/reject
//    Examiner rejects → paper = Rejected, exam = Draft
// ═════════════════════════════════════════════════════════════════
const rejectPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { instituteId } = req.user;
        const { paperId } = req.params;
        const { rejectionNote } = req.body;
        if (!(rejectionNote === null || rejectionNote === void 0 ? void 0 : rejectionNote.trim())) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "rejectionNote is required.",
            });
        }
        const result = yield questionPaper_service_1.default.rejectPaper(instituteId, paperId, rejectionNote);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
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
