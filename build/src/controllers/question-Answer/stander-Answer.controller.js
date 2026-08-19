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
exports.getAllAnswerSheets = exports.getPendingAnswerSheets = exports.publishAnswerSheet = exports.rejectAnswerSheet = exports.approveAnswerSheet = exports.submitAnswerSheet = exports.getQuestionPaperAnswerUploads = exports.getQuestionPaperAnswerBySelection = exports.uploadPdfController = exports.uploadImageController = exports.uploadFileToCloudinary = exports.createQuestionPaperAnswer = void 0;
const stander_answer_service_1 = __importDefault(require("../../services/question-answer/stander-answer.service"));
const Session_modal_1 = __importDefault(require("../../modals/Session.modal"));
const Class_modal_1 = __importDefault(require("../../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../../modals/Subject.modal"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const stander_answer_model_1 = __importDefault(require("../../modals/question-paper/stander-answer.model"));
const http_status_1 = __importDefault(require("http-status"));
const cloudinary_1 = __importDefault(require("../../utils/cloudinary"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const createQuestionPaperAnswer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { paperId, examId, teacherId, paperSet, answers, status, } = req.body;
        const instituteId = ((_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.instituteId) || req.body.instituteId;
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
const uploadFileToCloudinary = (file) => new Promise((resolve, reject) => {
    const uploadStream = cloudinary_1.default.uploader.upload_stream({
        folder: "answer-sheets",
        resource_type: "auto",
        public_id: `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    }, (error, result) => {
        if (error) {
            reject(error);
        }
        else {
            resolve((result === null || result === void 0 ? void 0 : result.secure_url) || "");
        }
    });
    uploadStream.end(file.buffer);
});
exports.uploadFileToCloudinary = uploadFileToCloudinary;
const uploadImageController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const files = req.files;
        const diagramFiles = [
            ...((files === null || files === void 0 ? void 0 : files.diagram) || []),
            ...((files === null || files === void 0 ? void 0 : files.diagramUrls) || []),
        ];
        const diagramUrls = [];
        for (const file of diagramFiles) {
            try {
                const url = yield (0, exports.uploadFileToCloudinary)(file);
                if (url)
                    diagramUrls.push(url);
            }
            catch (e) {
                console.error(`Cloudinary upload failed for ${file.originalname}:`, e.message);
            }
        }
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
const uploadPdfController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c;
    try {
        const files = Array.isArray(req.files)
            ? req.files
            : req.file
                ? [req.file]
                : [];
        const urls = [];
        for (const file of files) {
            try {
                const url = yield (0, exports.uploadFileToCloudinary)(file);
                if (url)
                    urls.push(url);
            }
            catch (e) {
                console.error(`Cloudinary upload failed for ${file.originalname}:`, e.message);
            }
        }
        if (urls.length === 0) {
            return res.status(400).json({
                error: true,
                message: "No files uploaded successfully.",
                data: { urls },
            });
        }
        const { paperId, examId, paperSet } = req.body;
        const instituteId = ((_b = req.viaExamUser) === null || _b === void 0 ? void 0 : _b.instituteId) || req.body.instituteId;
        const teacherId = ((_c = req.viaExamUser) === null || _c === void 0 ? void 0 : _c.userId) || req.body.teacherId;
        let dbResult = null;
        if (paperId && examId && paperSet && instituteId && teacherId) {
            try {
                dbResult = yield stander_answer_service_1.default.saveAnswerSheetPdfUrl({
                    paperId,
                    examId,
                    paperSet,
                    instituteId,
                    teacherId,
                    pdfUrl: urls[0],
                });
            }
            catch (dbErr) {
                console.error("Failed to save answer sheet PDF url to database:", dbErr.message);
            }
        }
        return res.status(200).json({
            error: false,
            message: "Answer sheet uploaded successfully",
            data: {
                urls,
                url: urls[0],
                questionPaperAnswer: dbResult,
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
exports.uploadPdfController = uploadPdfController;
const getQuestionPaperAnswerBySelection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    try {
        const { classVal, subject, examType, session, paperSet, } = req.body;
        const instituteId = ((_d = req.viaExamUser) === null || _d === void 0 ? void 0 : _d.instituteId) || req.body.instituteId;
        console.log("[getQuestionPaperAnswerBySelection] Request parameters:", {
            classVal,
            subject,
            examType,
            session,
            paperSet,
            instituteId,
        });
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
            console.warn(`[getQuestionPaperAnswerBySelection] 404: Session '${session}' not found for institute '${instituteId}'`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Session not found.",
            });
        }
        if (!classData) {
            console.warn(`[getQuestionPaperAnswerBySelection] 404: Class '${classVal}' not found for institute '${instituteId}'`);
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
            console.warn(`[getQuestionPaperAnswerBySelection] 404: Subject '${subject}' not found for class '${classVal}' (classId: ${classData.classId})`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Subject not found.",
            });
        }
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
            console.warn(`[getQuestionPaperAnswerBySelection] 404: Exam not found for session '${session}', class '${classVal}', subject '${subject}', examType '${examType}'`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Exam not found.",
            });
        }
        const questionPaperAnswer = yield stander_answer_model_1.default.findOne({
            where: {
                examId: exam.examId,
                paperSet,
            },
        });
        if (!questionPaperAnswer) {
            console.warn(`[getQuestionPaperAnswerBySelection] 404: Question paper answer not found for examId '${exam.examId}', paperSet '${paperSet}'`);
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                message: "Question paper answer not found for selected exam.",
            });
        }
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
// ─── APPROVAL WORKFLOW CONTROLLERS ─────────────────────────────────────────
const submitAnswerSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { answerId } = req.params;
        const teacherId = req.viaExamUser.userId;
        const answer = yield stander_answer_service_1.default.submitForApproval(answerId, teacherId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Answer sheet submitted for approval.",
            data: answer,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.submitAnswerSheet = submitAnswerSheet;
const approveAnswerSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { answerId } = req.params;
        const reviewerId = req.viaExamUser.userId;
        const answer = yield stander_answer_service_1.default.approveAnswer(answerId, reviewerId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Answer sheet approved.",
            data: answer,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.approveAnswerSheet = approveAnswerSheet;
const rejectAnswerSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { answerId } = req.params;
        const reviewerId = req.viaExamUser.userId;
        const { rejectionNote } = req.body;
        const answer = yield stander_answer_service_1.default.rejectAnswer(answerId, reviewerId, rejectionNote);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Answer sheet rejected.",
            data: answer,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.rejectAnswerSheet = rejectAnswerSheet;
const publishAnswerSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { answerId } = req.params;
        const answer = yield stander_answer_service_1.default.publishAnswer(answerId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Answer sheet published.",
            data: answer,
        });
    }
    catch (error) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            error: true,
            message: error.message,
        });
    }
});
exports.publishAnswerSheet = publishAnswerSheet;
const getPendingAnswerSheets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = req.viaExamUser.instituteId;
        const answers = yield stander_answer_service_1.default.getPendingAnswers(instituteId);
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Pending answer sheets fetched.",
            data: { answers },
        });
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            message: error.message,
        });
    }
});
exports.getPendingAnswerSheets = getPendingAnswerSheets;
const getAllAnswerSheets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = req.viaExamUser.instituteId;
        const { status, examId, teacherId } = req.query;
        const answers = yield stander_answer_service_1.default.getAnswers(instituteId, {
            status: status,
            examId: examId,
            teacherId: teacherId,
        });
        return res.status(http_status_1.default.OK).json({
            error: false,
            message: "Answer sheets fetched.",
            data: { answers },
        });
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            message: error.message,
        });
    }
});
exports.getAllAnswerSheets = getAllAnswerSheets;
