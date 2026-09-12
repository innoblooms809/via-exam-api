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
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const stander_answer_model_1 = __importDefault(require("../modals/question-paper/stander-answer.model"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const logger_1 = __importDefault(require("../config/logger"));
const axios_1 = __importDefault(require("axios"));
const pythonServices_1 = require("../config/pythonServices");
const questionPaperText_1 = require("../utils/questionPaperText");
const pipeline6_service_1 = require("./pipeline6.service");
// ─── TRIGGER EVALUATION ───────────────────────────────────────────────────────
const triggerEvaluation = (sheetId, force = false) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Fetch Scanner Sheet
        const sheet = yield Scanner_modal_1.default.findOne({
            where: { sheetId, isDeleted: false },
        });
        if (!sheet) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Answer sheet not found.",
            };
        }
        // 2. Check if already evaluating or completed
        let aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId } });
        if (aiEval && aiEval.status === "Success" && !force) {
            return {
                error: false,
                statusCode: http_status_1.default.OK,
                message: "Sheet already evaluated.",
                data: aiEval,
            };
        }
        if (aiEval && aiEval.status === "Pending" && !force) {
            const timeElapsed = Date.now() - new Date(aiEval.updatedAt).getTime();
            if (timeElapsed < 180000) { // 3 minutes
                return {
                    error: false,
                    statusCode: http_status_1.default.OK,
                    message: "Evaluation is already in progress.",
                    data: aiEval,
                };
            }
            logger_1.default.info(`Sheet ${sheetId} has been stuck in Pending for ${Math.round(timeElapsed / 1000)}s. Overriding and starting fresh evaluation.`);
        }
        // Lookup Student
        const student = yield Student_modal_1.default.findOne({
            where: {
                rollNumber: sheet.rollNo,
                instituteId: sheet.instituteId,
                classId: sheet.classId,
            },
        });
        const studentId = student ? student.userId : `STUDENT-${sheet.rollNo}`;
        // 3. Find or Create AIEvaluation record as Pending
        const evaluationId = yield helper_1.default.generateUserId();
        if (!aiEval) {
            aiEval = yield AIEvaluation_modal_1.default.create({
                evaluationId,
                sheetId,
                studentId,
                examId: sheet.examType,
                classId: sheet.classId,
                section: sheet.section,
                subjectId: sheet.subjectId,
                examType: sheet.examType,
                status: "Pending",
                totalScore: 0,
                feedback: "",
                evaluations: [],
                studentAnsOcr: "",
                standardAnsOcr: "",
                questionOcr: "",
            });
        }
        else {
            yield aiEval.update({
                status: "Pending",
                error: undefined,
            });
        }
        // 4. Resolve Exam and Question Paper details
        let examId = sheet.examType;
        let maxMarks = 10;
        let questionText = "Evaluate the student's answer sheet.";
        let standardAnsText = "Provide feedback and score according to subject correctness.";
        // Try to find the matching Exam (ordered by latest created)
        const exam = yield Exam_modal_1.default.findOne({
            where: {
                instituteId: sheet.instituteId,
                classId: sheet.classId,
                subjectId: sheet.subjectId,
                examType: sheet.examType,
                isDeleted: false,
            },
            order: [["createdAt", "DESC"]],
        });
        if (exam) {
            examId = exam.examId;
            maxMarks = exam.totalMarks || 10;
            // Target paperSet from student sheet section (e.g. "A", "B", etc.)
            const targetPaperSet = sheet.section || "A";
            // 1. Try matching exact paperSet for this exam & section
            let questionPaper = yield QuestionPaper_modal_1.default.findOne({
                where: {
                    examId: exam.examId,
                    instituteId: sheet.instituteId,
                    paperSet: targetPaperSet,
                },
                order: [["createdAt", "DESC"]],
            });
            // 2. Fallback: if no paperSet match for this examId, try finding any QuestionPaper for this examId
            if (!questionPaper) {
                logger_1.default.info(`No QuestionPaper found for examId '${exam.examId}' and paperSet '${targetPaperSet}'. Fetching latest QuestionPaper for examId '${exam.examId}'.`);
                questionPaper = yield QuestionPaper_modal_1.default.findOne({
                    where: {
                        examId: exam.examId,
                        instituteId: sheet.instituteId,
                    },
                    order: [["createdAt", "DESC"]],
                });
            }
            if (questionPaper) {
                // Find matching answers from QuestionPaperAnswer for paperId & paperSet
                let qpAnswer = yield stander_answer_model_1.default.findOne({
                    where: {
                        paperId: questionPaper.paperId,
                        paperSet: questionPaper.paperSet,
                    },
                });
                if (!qpAnswer) {
                    qpAnswer = yield stander_answer_model_1.default.findOne({
                        where: { paperId: questionPaper.paperId },
                    });
                }
                const ansDoc = qpAnswer ? qpAnswer.answers : null;
                const { questions, answers } = (0, questionPaperText_1.formatQuestionPaper)(questionPaper.content, ansDoc);
                if (questions)
                    questionText = questions;
                if (answers)
                    standardAnsText = answers;
            }
        }
        // 5. Run evaluation asynchronously in the background
        runBackgroundEvaluation(sheet, aiEval, studentId, examId, maxMarks, questionText, standardAnsText).catch((err) => {
            logger_1.default.error("Background evaluation trigger failed:", err);
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "AI evaluation triggered successfully.",
            data: aiEval,
        };
    }
    catch (error) {
        console.error("AI Evaluation initialization failed:", error);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Failed to initialize evaluation: ${error.message}`,
        };
    }
});
// Helper function to execute OCR & Evaluation in the background
const runBackgroundEvaluation = (sheet, aiEval, studentId, examId, maxMarks, questionText, standardAnsText) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g;
    try {
        // 1. Check file buffer validity
        if (!sheet.fileBuffer || sheet.fileBuffer.length === 0) {
            throw new Error("Answer sheet image file buffer is missing or empty in database.");
        }
        // Ensure filename has a valid extension (.png, .jpg, .jpeg, .webp, .pdf) for python ocr_server
        let fileName = sheet.fileName || "sheet.png";
        if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
            const ext = sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
            fileName = `${fileName}${ext}`;
        }
        // Call OCR API
        const ocrApiUrl = pythonServices_1.pythonServices.ocrUrl();
        const ocrFormData = new FormData();
        const fileBlob = new Blob([sheet.fileBuffer], { type: sheet.fileMimeType || "image/png" });
        ocrFormData.append("file", fileBlob, fileName);
        logger_1.default.info(`Sending student answer sheet (${fileName}, ${sheet.fileBuffer.length} bytes) to OCR API: ${ocrApiUrl}`);
        const ocrResponse = yield axios_1.default.post(ocrApiUrl, ocrFormData, {
            timeout: 3600000, // 1 hour
        });
        const ocrResult = ocrResponse.data;
        const studentAnsOcr = ocrResult.combined_markdown || "";
        logger_1.default.info("OCR completed successfully (background).");
        // 2. Call Evaluation API
        const evaluationApiUrl = pythonServices_1.pythonServices.evaluationUrl();
        const evalFormData = new FormData();
        evalFormData.append("student_id", studentId);
        evalFormData.append("exam_id", examId);
        evalFormData.append("question", questionText);
        evalFormData.append("expected_answer", standardAnsText);
        evalFormData.append("student_answer", studentAnsOcr);
        evalFormData.append("max_marks", String(maxMarks));
        logger_1.default.info(`Sending extracted text to Evaluation API (background): ${evaluationApiUrl}`);
        const evalResponse = yield axios_1.default.post(evaluationApiUrl, evalFormData, {
            timeout: 3600000, // 1 hour
        });
        const evalResult = evalResponse.data;
        logger_1.default.info("Evaluation completed successfully (background).");
        // 3. Save Successful Evaluation Details
        yield aiEval.update({
            status: "Success",
            totalScore: evalResult.total_score || 0,
            feedback: evalResult.feedback || "",
            evaluations: evalResult.evaluations || [],
            studentAnsOcr: studentAnsOcr,
            standardAnsOcr: standardAnsText,
            questionOcr: questionText,
            error: null, // clear previous errors if any
        });
        // 4. Update Scanner sheet status to Evaluated
        yield sheet.update({ status: "Evaluated" });
    }
    catch (error) {
        const detailMsg = ((_b = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.detail) ||
            ((_d = (_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.message) ||
            (typeof ((_e = error === null || error === void 0 ? void 0 : error.response) === null || _e === void 0 ? void 0 : _e.data) === "string" ? error.response.data : null) ||
            (error === null || error === void 0 ? void 0 : error.message) ||
            "Unknown error occurred during background AI evaluation.";
        logger_1.default.error(`AI Evaluation background job failed for sheet ${sheet.sheetId}:`, {
            message: error.message,
            responseData: (_f = error === null || error === void 0 ? void 0 : error.response) === null || _f === void 0 ? void 0 : _f.data,
            status: (_g = error === null || error === void 0 ? void 0 : error.response) === null || _g === void 0 ? void 0 : _g.status,
        });
        // Update status as Failed with full error detail
        yield aiEval.update({
            status: "Failed",
            error: detailMsg,
        });
    }
});
// ─── GET EVALUATION BY SHEET ID ───────────────────────────────────────────────
const getEvaluationBySheetId = (sheetId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId } });
        if (!aiEval) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Evaluation details not found for this sheet.",
            };
        }
        let studentName = "";
        let className = "";
        try {
            const student = yield User_modal_1.default.findOne({ where: { userId: aiEval.studentId } });
            if (student) {
                studentName = student.userName;
            }
        }
        catch (err) {
            logger_1.default.error("Failed to resolve student name for evaluation details:", err);
        }
        try {
            const classObj = yield Class_modal_1.default.findOne({ where: { classId: aiEval.classId } });
            if (classObj) {
                className = classObj.className;
            }
        }
        catch (err) {
            logger_1.default.error("Failed to resolve class name for evaluation details:", err);
        }
        const evalDataJson = aiEval.toJSON();
        evalDataJson.studentName = studentName;
        evalDataJson.className = className;
        // While Pending: where the sheet is in the Pipeline 6 queue (stage + place in line).
        evalDataJson.queue = (0, pipeline6_service_1.getSheetQueueInfo)(sheetId);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Evaluation details fetched.",
            data: evalDataJson,
        };
    }
    catch (error) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${error.message}`,
        };
    }
});
// ─── GET ALL EVALUATIONS (list with filters) ──────────────────────────────────
const getAllEvaluations = (query, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { classId, section, subjectId, examType, status } = query;
        const where = {};
        if (classId)
            where.classId = classId;
        if (section)
            where.section = section;
        if (subjectId)
            where.subjectId = subjectId;
        if (examType)
            where.examType = examType;
        if (status)
            where.status = status;
        const evaluations = yield AIEvaluation_modal_1.default.findAll({
            where,
            order: [["createdAt", "DESC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "AI evaluations list fetched successfully.",
            data: { evaluations, total: evaluations.length },
        };
    }
    catch (error) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${error.message}`,
        };
    }
});
// ─── UPDATE EVALUATION BY SHEET ID ────────────────────────────────────────────
const updateEvaluationBySheetId = (sheetId, data) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId } });
        if (!aiEval) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Evaluation details not found for this sheet.",
            };
        }
        yield aiEval.update({
            totalScore: data.totalScore,
            evaluations: data.evaluations,
            feedback: data.feedback !== undefined ? data.feedback : aiEval.feedback,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Evaluation details updated successfully.",
            data: aiEval,
        };
    }
    catch (error) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${error.message}`,
        };
    }
});
exports.default = {
    triggerEvaluation,
    getEvaluationBySheetId,
    getAllEvaluations,
    updateEvaluationBySheetId,
};
