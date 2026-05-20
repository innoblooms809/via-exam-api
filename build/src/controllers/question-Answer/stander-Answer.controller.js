"use strict";
// ======================================================
// CONTROLLER
// src/controllers/questionPaperAnswer.controller.ts
// ======================================================
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
exports.getQuestionPaperAnswerUploads = exports.getQuestionPaperAnswerBySelection = exports.uploadImageController = exports.createQuestionPaperAnswer = void 0;
const stander_answer_service_1 = __importDefault(require("../../services/question-answer/stander-answer.service"));
const Session_modal_1 = __importDefault(require("../../modals/Session.modal"));
const Class_modal_1 = __importDefault(require("../../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../../modals/Subject.modal"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const stander_answer_model_1 = __importDefault(require("../../modals/question-paper/stander-answer.model"));
const http_status_1 = __importDefault(require("http-status"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const createQuestionPaperAnswer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { paperId, examId, teacherId, paperSet, answers, status, } = req.body;
        const instituteId = ((_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.instituteId) || req.body.instituteId;
        // BASIC VALIDATION
        if (!instituteId ||
            !paperId ||
            !examId ||
            !teacherId ||
            !paperSet ||
            !answers) {
            return res.status(400).json({
                success: false,
                message: "Missing required fields",
            });
        }
        const result = yield stander_answer_service_1.default.createQuestionPaperAnswer({
            instituteId,
            paperId,
            examId,
            teacherId,
            paperSet,
            answers,
            status,
        });
        return res.status(201).json({
            success: true,
            message: "Question paper answer created successfully",
            data: result,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            message: error.message,
        });
    }
});
exports.createQuestionPaperAnswer = createQuestionPaperAnswer;
const uploadImageController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = req.files;
        const toUploadUrl = (file) => `/${file.path.replace(/\\/g, "/").replace(/^uploads\//, "uploads/")}`;
        const diagramFiles = [
            ...((files === null || files === void 0 ? void 0 : files.diagram) || []),
            ...((files === null || files === void 0 ? void 0 : files.diagramUrls) || []),
        ];
        const diagramUrls = diagramFiles.map(toUploadUrl);
        return res.status(200).json({
            error: false,
            message: "Images uploaded successfully",
            data: {
                diagramUrls,
            },
        });
    }
    catch (e) {
        return res.status(500).json({
            error: true,
            message: e.message,
        });
    }
});
exports.uploadImageController = uploadImageController;
const getQuestionPaperAnswerBySelection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    try {
        const { classVal, subject, examType, session, paperSet, } = req.body;
        const instituteId = ((_b = req.viaExamUser) === null || _b === void 0 ? void 0 : _b.instituteId) || req.body.instituteId;
        // ─────────────────────────────────────────────
        // FIND SESSION + CLASS
        // ─────────────────────────────────────────────
        const [sessionData, classData] = yield Promise.all([
            Session_modal_1.default.findOne({
                where: {
                    sessionName: session,
                    instituteId,
                    isDeleted: false,
                },
            }),
            Class_modal_1.default.findOne({
                where: {
                    className: classVal,
                    instituteId,
                    isDeleted: false,
                },
            }),
        ]);
        if (!sessionData) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Session not found.",
            });
        }
        if (!classData) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Class not found.",
            });
        }
        // ─────────────────────────────────────────────
        // FIND SUBJECT
        // ─────────────────────────────────────────────
        const subjectData = yield Subject_modal_1.default.findOne({
            where: {
                subjectName: subject,
                classId: classData.classId,
                instituteId,
                isDeleted: false,
            },
        });
        if (!subjectData) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Subject not found.",
            });
        }
        // ─────────────────────────────────────────────
        // FIND EXAM
        // ─────────────────────────────────────────────
        const exam = yield Exam_modal_1.default.findOne({
            where: {
                sessionId: sessionData.sessionId,
                classId: classData.classId,
                subjectId: subjectData.subjectId,
                examType,
                instituteId,
                isDeleted: false,
            },
        });
        if (!exam) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Exam not found.",
            });
        }
        // ─────────────────────────────────────────────
        // FIND QUESTION PAPER ANSWER
        // ─────────────────────────────────────────────
        const questionPaperAnswer = yield stander_answer_model_1.default.findOne({
            where: {
                examId: exam.examId,
                paperSet,
            },
        });
        if (!questionPaperAnswer) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Question paper answer not found for selected exam.",
            });
        }
        // ─────────────────────────────────────────────
        // SUCCESS
        // ─────────────────────────────────────────────
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Question paper answer fetched successfully.",
            data: {
                exam,
                questionPaperAnswer,
            },
        });
    }
    catch (error) {
        console.error("getQuestionPaperAnswerBySelection Error:", error);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            message: `Something went wrong: ${error.message}`,
        });
    }
});
exports.getQuestionPaperAnswerBySelection = getQuestionPaperAnswerBySelection;
const getQuestionPaperAnswerUploads = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const baseDir = path_1.default.join(process.cwd(), "uploads", "question-papers");
        const listFiles = (dir, urlPath) => {
            if (!fs_1.default.existsSync(dir))
                return [];
            return fs_1.default
                .readdirSync(dir)
                .filter((file) => fs_1.default.statSync(path_1.default.join(dir, file)).isFile())
                .map((file) => `/uploads/question-papers/${urlPath}/${file}`);
        };
        return res.json({
            error: false,
            data: {
                diagrams: listFiles(path_1.default.join(baseDir, "diagrams"), "diagrams"),
            },
        });
    }
    catch (e) {
        return res.status(500).json({
            error: true,
            message: e.message,
        });
    }
});
exports.getQuestionPaperAnswerUploads = getQuestionPaperAnswerUploads;
