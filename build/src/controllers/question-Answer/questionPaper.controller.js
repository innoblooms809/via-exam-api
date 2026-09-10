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
exports.addExamRemarkController = exports.getExamRemarksController = exports.rejectExamPair = exports.approveExamPair = exports.getAllQuestionPapers = exports.getPendingQuestionPapers = exports.publishQuestionPaper = exports.rejectQuestionPaper = exports.approveQuestionPaper = exports.submitQuestionPaper = exports.submitExamForApproval = exports.getQuestionPaperUploads = exports.getQuestionPaperBySelection = exports.uploadImageController = exports.createQuestionPaper = void 0;
const sequelize_1 = require("sequelize");
const questionPaper_service_1 = require("../../services/question-answer/questionPaper.service");
const QuestionPaper_modal_1 = __importDefault(require("../../modals/question-paper/QuestionPaper.modal"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const http_status_1 = __importDefault(require("http-status"));
const Session_modal_1 = __importDefault(require("../../modals/Session.modal"));
const Class_modal_1 = __importDefault(require("../../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../../modals/Subject.modal"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const getQuestionPaperErrorMessage = (error) => {
    var _a, _b, _c;
    if (error instanceof sequelize_1.UniqueConstraintError) {
        const fields = Object.keys(error.fields || {});
        if (fields.includes("paperId")) {
            return "Question paper ID already exists";
        }
        if (fields.includes("paper_set") ||
            (error === null || error === void 0 ? void 0 : error.constraint) === "uq_question_paper_exam_paper_set") {
            return "A question paper with this Set already exists for the selected exam. Please choose a different Set.";
        }
        return ((_b = (_a = error.errors) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) || "Duplicate question paper data";
    }
    if (error instanceof sequelize_1.ForeignKeyConstraintError) {
        return "Invalid institute, exam, or teacher selected";
    }
    if (error instanceof sequelize_1.ValidationError) {
        return ((_c = error.errors) === null || _c === void 0 ? void 0 : _c.map((item) => item.message).join(", ")) || error.message;
    }
    return error.message || "Something went wrong";
};
const createQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { examId, teacherId, paperSet, content, } = req.body;
        const instituteId = ((_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.instituteId) || req.body.instituteId;
        if (!instituteId ||
            !examId ||
            !paperSet ||
            !content) {
            return res.status(400).json({
                message: "All fields are required",
            });
        }
        if (teacherId !== undefined && typeof teacherId !== "string") {
            return res.status(400).json({
                message: "teacherId must be a string",
            });
        }
        yield questionPaper_service_1.QuestionPaperService.createQuestionPaper({
            instituteId,
            examId,
            teacherId,
            paperSet,
            content,
        });
        return res.status(201).json({
            message: "Question paper created successfully",
        });
    }
    catch (error) {
        return res.status(400).json({
            message: getQuestionPaperErrorMessage(error),
        });
    }
});
exports.createQuestionPaper = createQuestionPaper;
const uploadImageController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    try {
        const files = req.files;
        const toUploadUrl = (file) => `/${file.path.replace(/\\/g, "/").replace(/^uploads\//, "uploads/")}`;
        const diagramFiles = [
            ...((files === null || files === void 0 ? void 0 : files.diagram) || []),
            ...((files === null || files === void 0 ? void 0 : files.diagramUrls) || []),
        ];
        const diagramUrls = diagramFiles.map(toUploadUrl);
        const schoolLogo = ((_b = files === null || files === void 0 ? void 0 : files.schoolLogo) === null || _b === void 0 ? void 0 : _b[0])
            ? toUploadUrl(files.schoolLogo[0])
            : null;
        return res.status(200).json({
            error: false,
            message: "Images uploaded successfully",
            data: {
                schoolLogo,
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
const getQuestionPaperBySelection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _c;
    try {
        const { classVal, subject, examType, session, paperSet, examId, } = req.body;
        const instituteId = ((_c = req.viaExamUser) === null || _c === void 0 ? void 0 : _c.instituteId) || req.body.instituteId;
        console.log("[getQuestionPaperBySelection] Request parameters:", {
            classVal,
            subject,
            examType,
            session,
            paperSet,
            examId,
            instituteId,
        });
        // 1. Direct lookup by examId if provided
        if (examId) {
            const qpWhere = { examId };
            if (paperSet)
                qpWhere.paperSet = paperSet;
            const directQp = yield QuestionPaper_modal_1.default.findOne({ where: qpWhere });
            if (directQp) {
                const examObj = yield Exam_modal_1.default.findOne({ where: { examId } });
                return res.status(http_status_1.default.OK).json({
                    error: false,
                    message: "Question paper fetched successfully.",
                    data: {
                        exam: examObj || { examId, examType, subjectName: subject, className: classVal },
                        questionPaper: directQp,
                    },
                });
            }
        }
        // 2. Lookup by session, class, subject, examType
        const cleanClass = (classVal || "").replace(/^class\s*/i, "").trim();
        const classWhere = { instituteId, isDeleted: false };
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
                    [sequelize_1.Op.or]: [
                        { className: classVal },
                        { className: `Class ${cleanClass}` },
                        { className: cleanClass },
                    ],
                    instituteId,
                    isDeleted: false,
                },
            }),
        ]);
        if (!sessionData && session) {
            console.warn(`[getQuestionPaperBySelection] 404: Session '${session}' not found for institute '${instituteId}'`);
        }
        if (!classData) {
            console.warn(`[getQuestionPaperBySelection] 404: Class '${classVal}' not found for institute '${instituteId}'`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Class not found.",
            });
        }
        const subjectData = yield Subject_modal_1.default.findOne({
            where: {
                subjectName: subject,
                classId: classData.classId,
                instituteId,
                isDeleted: false,
            },
        });
        if (!subjectData) {
            console.warn(`[getQuestionPaperBySelection] 404: Subject '${subject}' not found for class '${classVal}' (classId: ${classData.classId})`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Subject not found.",
            });
        }
        const examWhere = {
            classId: classData.classId,
            subjectId: subjectData.subjectId,
            examType,
            instituteId,
            isDeleted: false,
        };
        if (sessionData)
            examWhere.sessionId = sessionData.sessionId;
        const exam = yield Exam_modal_1.default.findOne({ where: examWhere });
        if (!exam) {
            console.warn(`[getQuestionPaperBySelection] 404: Exam not found for session '${session}', class '${classVal}', subject '${subject}', examType '${examType}'`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Exam not found.",
            });
        }
        const qpWhere = { examId: exam.examId };
        if (paperSet)
            qpWhere.paperSet = paperSet;
        const questionPaper = yield QuestionPaper_modal_1.default.findOne({ where: qpWhere });
        if (!questionPaper) {
            console.warn(`[getQuestionPaperBySelection] 404: Question paper not found for examId '${exam.examId}', paperSet '${paperSet}'`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Question paper not found for selected exam.",
            });
        }
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Question paper fetched successfully.",
            data: {
                exam,
                questionPaper,
            },
        });
    }
    catch (error) {
        console.error("getQuestionPaperBySelection Error:", error);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            message: `Something went wrong: ${error.message}`,
        });
    }
});
exports.getQuestionPaperBySelection = getQuestionPaperBySelection;
const getQuestionPaperUploads = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
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
                schoolLogos: listFiles(path_1.default.join(baseDir, "school-logos"), "school-logos"),
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
exports.getQuestionPaperUploads = getQuestionPaperUploads;
// ─── APPROVAL WORKFLOW CONTROLLERS ─────────────────────────────────────────
const submitExamForApproval = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examId } = req.params;
        const teacherId = req.viaExamUser.userId;
        const result = yield questionPaper_service_1.QuestionPaperService.submitExamForApproval(examId, teacherId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Exam question paper and answer sheet submitted for approval successfully.",
            data: result,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.submitExamForApproval = submitExamForApproval;
const submitQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { paperId } = req.params;
        const teacherId = req.viaExamUser.userId;
        const paper = yield questionPaper_service_1.QuestionPaperService.submitForApproval(paperId, teacherId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Question paper submitted for approval.",
            data: paper,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.submitQuestionPaper = submitQuestionPaper;
const approveQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { paperId } = req.params;
        const reviewerId = req.viaExamUser.userId;
        const paper = yield questionPaper_service_1.QuestionPaperService.approvePaper(paperId, reviewerId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Question paper approved.",
            data: paper,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.approveQuestionPaper = approveQuestionPaper;
const rejectQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { paperId } = req.params;
        const reviewerId = req.viaExamUser.userId;
        const { rejectionNote } = req.body;
        const paper = yield questionPaper_service_1.QuestionPaperService.rejectPaper(paperId, reviewerId, rejectionNote);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Question paper rejected.",
            data: paper,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.rejectQuestionPaper = rejectQuestionPaper;
const publishQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { paperId } = req.params;
        const paper = yield questionPaper_service_1.QuestionPaperService.publishPaper(paperId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Question paper published.",
            data: paper,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.publishQuestionPaper = publishQuestionPaper;
const getPendingQuestionPapers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = req.viaExamUser.instituteId;
        const papers = yield questionPaper_service_1.QuestionPaperService.getPendingPapers(instituteId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Pending question papers fetched.",
            data: { papers },
        });
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            message: error.message,
        });
    }
});
exports.getPendingQuestionPapers = getPendingQuestionPapers;
const getAllQuestionPapers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = req.viaExamUser.instituteId;
        const { status, examId, teacherId } = req.query;
        const papers = yield questionPaper_service_1.QuestionPaperService.getPapers(instituteId, {
            status: status,
            examId: examId,
            teacherId: teacherId,
        });
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Question papers fetched.",
            data: { papers },
        });
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            message: error.message,
        });
    }
});
exports.getAllQuestionPapers = getAllQuestionPapers;
const approveExamPair = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examId } = req.params;
        const reviewerId = req.viaExamUser.userId;
        const result = yield questionPaper_service_1.QuestionPaperService.approveExamPair(examId, reviewerId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Exam question paper and answer sheet approved successfully.",
            data: result,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.approveExamPair = approveExamPair;
const rejectExamPair = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examId } = req.params;
        const reviewerId = req.viaExamUser.userId;
        const { rejectionNote } = req.body;
        const result = yield questionPaper_service_1.QuestionPaperService.rejectExamPair(examId, reviewerId, rejectionNote);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Exam question paper and answer sheet rejected.",
            data: result,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.rejectExamPair = rejectExamPair;
// ─── REMARKS / CHAT CONTROLLERS ─────────────────────────────────────────
const getExamRemarksController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examId } = req.params;
        const result = yield questionPaper_service_1.QuestionPaperService.getExamRemarks(examId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Remarks fetched successfully.",
            data: result,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.getExamRemarksController = getExamRemarksController;
const addExamRemarkController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    try {
        const { examId } = req.params;
        const { remark } = req.body;
        const user = req.viaExamUser || req.user || {};
        const rawRole = (typeof user.role === "object" ? (_d = user.role) === null || _d === void 0 ? void 0 : _d.role : user.role || "ADMIN").toString().toUpperCase();
        const senderRole = rawRole.includes("TEACH") ? "TEACHER" : "ADMIN";
        const senderName = user.name || user.fullName || (senderRole === "TEACHER" ? "Teacher" : "Admin Reviewer");
        const result = yield questionPaper_service_1.QuestionPaperService.addExamRemark(examId, remark, senderRole, senderName);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Remark added successfully.",
            data: result,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.addExamRemarkController = addExamRemarkController;
