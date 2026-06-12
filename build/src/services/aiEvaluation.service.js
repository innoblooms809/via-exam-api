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
const helper_1 = __importDefault(require("../utils/helper"));
// Helper to format question paper content into text
const formatQuestionPaper = (content, ansDoc) => {
    var _a, _b;
    let questions = "";
    let answers = "";
    if (!content) {
        return { questions, answers };
    }
    // Parse ansDoc map
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
                if (id) {
                    answerMap[id] = a;
                }
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
    // Handle case where title is available
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
        // Fallback simple stringify for non-standard JSON schemas
        questions = JSON.stringify(content, null, 2);
    }
    return { questions, answers };
};
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
            return {
                error: false,
                statusCode: http_status_1.default.OK,
                message: "Evaluation is already in progress.",
                data: aiEval,
            };
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
        // Try to find the matching Exam
        const exam = yield Exam_modal_1.default.findOne({
            where: {
                instituteId: sheet.instituteId,
                classId: sheet.classId,
                subjectId: sheet.subjectId,
                examType: sheet.examType,
                isDeleted: false,
            },
        });
        if (exam) {
            examId = exam.examId;
            maxMarks = exam.totalMarks || 10;
            // Try to find the approved or published Question Paper for this Exam
            const questionPaper = yield QuestionPaper_modal_1.default.findOne({
                where: {
                    examId: exam.examId,
                    instituteId: sheet.instituteId,
                },
            });
            if (questionPaper) {
                // Find matching answers from QuestionPaperAnswer
                const qpAnswer = yield stander_answer_model_1.default.findOne({
                    where: { paperId: questionPaper.paperId }
                });
                const ansDoc = qpAnswer ? qpAnswer.answers : null;
                const { questions, answers } = formatQuestionPaper(questionPaper.content, ansDoc);
                if (questions)
                    questionText = questions;
                if (answers)
                    standardAnsText = answers;
            }
        }
        // 5. Send file buffer to Python API (OCR + Evaluation)
        const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000/ocr-evaluation-text-ref";
        // Construct FormData using Node 18 native Blob & FormData
        const formData = new FormData();
        const fileBlob = new Blob([sheet.fileBuffer], { type: sheet.fileMimeType });
        formData.append("student_ans", fileBlob, sheet.fileName);
        formData.append("question_text", questionText);
        formData.append("standard_ans_text", standardAnsText);
        formData.append("max_marks", String(maxMarks));
        formData.append("student_id", studentId);
        formData.append("exam_id", examId);
        // Run fetch calling the python api
        const response = yield fetch(pythonApiUrl, {
            method: "POST",
            body: formData,
        });
        if (!response.ok) {
            const errorText = yield response.text();
            throw new Error(`Python API Error (${response.status}): ${errorText}`);
        }
        const result = yield response.json();
        // 6. Save Successful Evaluation Details
        yield aiEval.update({
            status: "Success",
            totalScore: result.total_score || 0,
            feedback: result.feedback || "",
            evaluations: result.evaluations || [],
            studentAnsOcr: result.student_ans_ocr || "",
            standardAnsOcr: standardAnsText,
            questionOcr: questionText,
        });
        // 7. Update Scanner sheet status to Evaluated so it shows up in UI
        yield sheet.update({ status: "Evaluated" });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Evaluation completed successfully.",
            data: aiEval,
        };
    }
    catch (error) {
        console.error("AI Evaluation failed:", error);
        // Update AI Evaluation status as Failed
        const aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId } });
        if (aiEval) {
            yield aiEval.update({
                status: "Failed",
                error: error.message || "Unknown error occurred during AI evaluation.",
            });
        }
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Evaluation failed: ${error.message}`,
        };
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
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Evaluation details fetched.",
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
exports.default = {
    triggerEvaluation,
    getEvaluationBySheetId,
    getAllEvaluations,
};
