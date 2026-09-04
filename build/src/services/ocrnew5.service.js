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
exports.evaluateSheetOCRNew5 = void 0;
const http_status_1 = __importDefault(require("http-status"));
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const stander_answer_model_1 = __importDefault(require("../modals/question-paper/stander-answer.model"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const ApiError_1 = __importDefault(require("../utils/ApiError"));
const helper_1 = __importDefault(require("../utils/helper"));
const logger_1 = __importDefault(require("../config/logger"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
// Helper to format question paper content into text
const formatQuestionPaper = (content, ansDoc) => {
    var _a, _b;
    let questions = "";
    let answers = "";
    if (!content)
        return { questions, answers };
    const answerMap = {};
    if (ansDoc) {
        let ansData = ansDoc;
        if (typeof ansData === "string") {
            try {
                ansData = JSON.parse(ansData);
            }
            catch (_c) { }
        }
        if (Array.isArray(ansData)) {
            ansData.forEach((a) => {
                const id = a.questionId || a.id || a.key;
                if (id)
                    answerMap[id] = a;
            });
        }
        else if (ansData && typeof ansData === "object") {
            Object.keys(ansData).forEach((key) => {
                const a = ansData[key];
                const id = a.questionId || a.id || a.key || key;
                answerMap[id] = a;
            });
        }
    }
    if (content.title) {
        questions += `Title: ${content.title}\n`;
    }
    let foundQuestions = false;
    if (Array.isArray(content.sections) && content.sections.length > 0) {
        for (const section of content.sections) {
            const secName = section.name || section.title || "";
            if (!secName && (!section.questions || section.questions.length === 0))
                continue;
            questions += `\n--- Section: ${secName} ---\n`;
            if (section.instructions) {
                questions += `Instructions: ${section.instructions}\n`;
            }
            if (Array.isArray(section.questions)) {
                for (const q of section.questions) {
                    foundQuestions = true;
                    const qId = q.questionId || q.id || q.key || "";
                    const qText = q.text || q.question || "";
                    const qMarks = q.marks !== undefined ? q.marks : "";
                    questions += `${qId}. ${qText} ${qMarks ? `[Marks: ${qMarks}]` : ""}\n`;
                    const expectedAns = ((_a = answerMap[qId]) === null || _a === void 0 ? void 0 : _a.answer) || q.answer;
                    if (expectedAns) {
                        answers += `${qId}. Expected Answer: ${expectedAns}\n`;
                    }
                }
            }
        }
    }
    if (Array.isArray(content.questions) && content.questions.length > 0) {
        questions += `\n--- Questions ---\n`;
        for (const q of content.questions) {
            foundQuestions = true;
            const qId = q.questionId || q.id || q.key || "";
            const qText = q.text || q.question || "";
            const qMarks = q.marks !== undefined ? q.marks : "";
            questions += `${qId}. ${qText} ${qMarks ? `[Marks: ${qMarks}]` : ""}\n`;
            const expectedAns = ((_b = answerMap[qId]) === null || _b === void 0 ? void 0 : _b.answer) || q.answer;
            if (expectedAns) {
                answers += `${qId}. Expected Answer: ${expectedAns}\n`;
            }
        }
    }
    if (!foundQuestions && typeof content === "object") {
        questions = JSON.stringify(content, null, 2);
    }
    return { questions, answers };
};
const evaluateSheetOCRNew5 = (sheetId) => __awaiter(void 0, void 0, void 0, function* () {
    logger_1.default.info(`[OCRNew5 Service] Initiating AI evaluation for sheet: ${sheetId}`);
    // 1. Fetch Scanner Sheet
    const sheet = (yield Scanner_modal_1.default.findOne({ where: { sheetId, isDeleted: false } })) || (yield Scanner_modal_1.default.findByPk(sheetId));
    if (!sheet) {
        throw new ApiError_1.default(http_status_1.default.NOT_FOUND, "Scanner sheet not found.");
    }
    // 2. Perform OCR on Student Answer Sheet if image/buffer available
    let studentAnsText = sheet.ocrText || sheet.answerText || "";
    if (!studentAnsText && sheet.fileBuffer && sheet.fileBuffer.length > 0) {
        try {
            const ocrApiUrl = process.env.OCR_API_URL || "http://localhost:8000/ocrOutput";
            let fileName = sheet.fileName || "sheet.png";
            if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
                const ext = sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
                fileName = `${fileName}${ext}`;
            }
            const ocrFormData = new form_data_1.default();
            ocrFormData.append("file", sheet.fileBuffer, {
                filename: fileName,
                contentType: sheet.fileMimeType || "image/png",
            });
            logger_1.default.info(`[OCRNew5 Service] Performing OCR on sheet image (${fileName})...`);
            const ocrRes = yield axios_1.default.post(ocrApiUrl, ocrFormData, {
                headers: ocrFormData.getHeaders(),
                timeout: 3600000,
            });
            if (ocrRes.data && ocrRes.data.combined_markdown) {
                studentAnsText = ocrRes.data.combined_markdown;
                logger_1.default.info(`[OCRNew5 Service] OCR successful (${studentAnsText.length} characters extracted).`);
            }
        }
        catch (ocrErr) {
            logger_1.default.error("[OCRNew5 Service] OCR step failed:", ocrErr.message);
        }
    }
    // 3. Resolve Student, Question Paper, Answer Key
    const student = yield Student_modal_1.default.findOne({
        where: { rollNumber: sheet.rollNo, instituteId: sheet.instituteId, classId: sheet.classId },
    });
    const studentId = student ? student.userId : (sheet.studentId || `STUDENT-${sheet.rollNo}`);
    let examId = sheet.examType;
    let maxMarks = 10;
    let questionText = "Evaluate student answer sheet.";
    let answerKeyText = "";
    const exam = yield Exam_modal_1.default.findOne({
        where: { instituteId: sheet.instituteId, classId: sheet.classId, subjectId: sheet.subjectId, examType: sheet.examType, isDeleted: false },
        order: [["createdAt", "DESC"]],
    });
    if (exam) {
        examId = exam.examId;
        maxMarks = exam.totalMarks || 10;
        const targetPaperSet = sheet.section || "A";
        let questionPaper = (yield QuestionPaper_modal_1.default.findOne({
            where: { examId: exam.examId, instituteId: sheet.instituteId, paperSet: targetPaperSet },
            order: [["createdAt", "DESC"]],
        })) || (yield QuestionPaper_modal_1.default.findOne({
            where: { examId: exam.examId, instituteId: sheet.instituteId },
            order: [["createdAt", "DESC"]],
        }));
        if (questionPaper) {
            let qpAnswer = (yield stander_answer_model_1.default.findOne({
                where: { paperId: questionPaper.paperId, paperSet: questionPaper.paperSet },
            })) || (yield stander_answer_model_1.default.findOne({
                where: { paperId: questionPaper.paperId },
            }));
            const { questions, answers } = formatQuestionPaper(questionPaper.content, qpAnswer ? qpAnswer.answers : null);
            if (questions)
                questionText = questions;
            if (answers)
                answerKeyText = answers;
        }
    }
    // 4. Send Payload to OCRNew5 multi-agent pipeline on port 8006
    const pipelineUrl = process.env.OCRNEW5_PIPELINE_URL || "http://localhost:8006/evaluate-text";
    const pipelinePayload = {
        student_id: studentId,
        exam_id: examId,
        question_paper_text: questionText,
        answer_key_text: answerKeyText,
        student_answer_text: studentAnsText || "No student answer text available.",
        max_marks: maxMarks,
    };
    logger_1.default.info(`[OCRNew5 Service] Posting payload to multi-agent pipeline: ${pipelineUrl}`);
    const evalResponse = yield axios_1.default.post(pipelineUrl, pipelinePayload, {
        headers: { "Content-Type": "application/json" },
        timeout: 3600000,
    });
    const evalResult = evalResponse.data;
    logger_1.default.info("[OCRNew5 Service] Multi-agent evaluation completed successfully.");
    // 5. Save or Update AIEvaluation record in database
    try {
        let aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId: sheet.sheetId } });
        const totalScore = evalResult.total_score || evalResult.score || 0;
        const feedbackText = typeof evalResult.feedback === "object" ? (evalResult.feedback.overall || JSON.stringify(evalResult.feedback)) : (evalResult.feedback || "");
        const evalPayload = {
            sheetId: sheet.sheetId,
            studentId,
            examId,
            classId: sheet.classId,
            section: sheet.section,
            subjectId: sheet.subjectId,
            examType: sheet.examType,
            status: "Success",
            totalScore,
            feedback: feedbackText,
            evaluations: evalResult.evaluations || evalResult.results || [],
            studentAnsOcr: studentAnsText,
            standardAnsOcr: answerKeyText,
            questionOcr: questionText,
            error: undefined,
        };
        if (!aiEval) {
            const evaluationId = yield helper_1.default.generateUserId();
            yield AIEvaluation_modal_1.default.create(Object.assign({ evaluationId }, evalPayload));
        }
        else {
            yield aiEval.update(evalPayload);
        }
        yield sheet.update({ status: "Evaluated" });
    }
    catch (dbErr) {
        logger_1.default.error("[OCRNew5 Service] Failed to save evaluation to DB:", dbErr.message);
    }
    return evalResult;
});
exports.evaluateSheetOCRNew5 = evaluateSheetOCRNew5;
exports.default = {
    evaluateSheetOCRNew5: exports.evaluateSheetOCRNew5,
};
