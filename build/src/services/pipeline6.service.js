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
exports.triggerPipeline6Evaluation = void 0;
const http_status_1 = __importDefault(require("http-status"));
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const stander_answer_model_1 = __importDefault(require("../modals/question-paper/stander-answer.model"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const logger_1 = __importDefault(require("../config/logger"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const pythonServices_1 = require("../config/pythonServices");
// Helper to format question paper content into text
const formatQuestionPaper = (content, ansDoc) => {
    let questions = "";
    let answers = "";
    let calculatedTotalMarks = 0;
    if (!content) {
        return { questions: "", answers: "", calculatedTotalMarks: 0 };
    }
    let parsedContent = content;
    if (typeof content === "string") {
        try {
            parsedContent = JSON.parse(content);
        }
        catch (e) {
            return { questions: content, answers: "", calculatedTotalMarks: 0 };
        }
    }
    let answerMap = {};
    if (ansDoc) {
        let parsedAns = ansDoc;
        if (typeof ansDoc === "string") {
            try {
                parsedAns = JSON.parse(ansDoc);
            }
            catch (e) { }
        }
        if (Array.isArray(parsedAns)) {
            parsedAns.forEach((item) => {
                const qId = String(item.questionId || item.question_id || item.id || "");
                if (qId)
                    answerMap[qId] = item;
            });
        }
        else if (typeof parsedAns === "object" && parsedAns !== null) {
            if (Array.isArray(parsedAns.answers)) {
                parsedAns.answers.forEach((item) => {
                    const qId = String(item.questionId || item.question_id || item.id || "");
                    if (qId)
                        answerMap[qId] = item;
                });
            }
            else {
                Object.keys(parsedAns).forEach((key) => {
                    answerMap[key] = parsedAns[key];
                });
            }
        }
    }
    let foundQuestions = false;
    const processSingleQuestion = (q) => {
        var _a, _b;
        foundQuestions = true;
        const qId = String(q.questionId || q.id || q.number || "");
        const qText = q.questionText || q.text || q.title || q.question || "";
        const rawMarks = q.marks !== undefined ? q.marks : q.maxMarks;
        const numMarks = Number(rawMarks);
        if (!isNaN(numMarks) && numMarks > 0) {
            calculatedTotalMarks += numMarks;
        }
        const marksFormatted = !isNaN(numMarks) && numMarks > 0
            ? `[Marks: ${numMarks}]`
            : rawMarks !== null && rawMarks !== undefined && rawMarks !== ""
                ? `[Marks: ${rawMarks}]`
                : "";
        questions += `${qId}. ${qText} ${marksFormatted}\n`.trim() + "\n";
        const expectedAns = ((_a = answerMap[qId]) === null || _a === void 0 ? void 0 : _a.answer) ||
            ((_b = answerMap[q.id]) === null || _b === void 0 ? void 0 : _b.answer) ||
            q.answer ||
            q.expectedAnswer ||
            "";
        if (expectedAns) {
            answers += `${qId}. Expected Answer: ${expectedAns}\n`;
        }
    };
    if (Array.isArray(parsedContent.sections) && parsedContent.sections.length > 0) {
        for (const section of parsedContent.sections) {
            const secName = section.name || section.title || "";
            if (!secName && (!section.questions || section.questions.length === 0))
                continue;
            questions += `\n--- Section: ${secName} ---\n`;
            if (section.instructions) {
                questions += `Instructions: ${section.instructions}\n`;
            }
            if (Array.isArray(section.questions)) {
                for (const q of section.questions) {
                    processSingleQuestion(q);
                }
            }
        }
    }
    if (Array.isArray(parsedContent.questions) && parsedContent.questions.length > 0) {
        if (!parsedContent.sections || parsedContent.sections.length === 0) {
            questions += `\n--- Questions ---\n`;
        }
        for (const q of parsedContent.questions) {
            processSingleQuestion(q);
        }
    }
    if (!foundQuestions && typeof parsedContent === "object") {
        questions = JSON.stringify(parsedContent, null, 2);
    }
    return { questions, answers, calculatedTotalMarks };
};
// ─── Pipeline 6.3 Evaluation Trigger ──────────────────────────────────────────
const triggerPipeline6Evaluation = (sheetId, force = false) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Fetch Scanner Sheet
        const sheet = (yield Scanner_modal_1.default.findOne({ where: { sheetId, isDeleted: false } })) || (yield Scanner_modal_1.default.findByPk(sheetId));
        if (!sheet) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Scanner sheet not found.",
            };
        }
        // 2. Find or reset AIEvaluation record
        let aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId } });
        if (aiEval && aiEval.status === "Pending" && !force) {
            const timeElapsed = Date.now() - new Date(aiEval.updatedAt).getTime();
            if (timeElapsed < 60000) { // 1 minute protection against rapid double clicks
                return {
                    error: false,
                    statusCode: http_status_1.default.OK,
                    message: "Pipeline 6.3 evaluation is already in progress.",
                    data: aiEval,
                };
            }
            logger_1.default.info(`Sheet ${sheetId} has been in Pending for ${Math.round(timeElapsed / 1000)}s. Starting fresh Pipeline 6.3 evaluation.`);
        }
        // 3. Resolve Student, Question Paper, Answer Key
        const student = yield Student_modal_1.default.findOne({
            where: { rollNumber: sheet.rollNo, instituteId: sheet.instituteId, classId: sheet.classId },
        });
        const studentId = student ? student.userId : (sheet.studentId || `STUDENT-${sheet.rollNo}`);
        let examId = sheet.examType || "EXAM-1";
        let maxMarks = 10;
        let questionText = "Evaluate student answer sheet.";
        let standardAnsText = "";
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
                const { questions, answers, calculatedTotalMarks } = formatQuestionPaper(questionPaper.content, qpAnswer ? qpAnswer.answers : null);
                if (questions)
                    questionText = questions;
                if (answers)
                    standardAnsText = answers;
                if (calculatedTotalMarks > 0) {
                    maxMarks = calculatedTotalMarks;
                }
            }
        }
        // 4. Upsert AIEvaluation Record
        if (!aiEval) {
            aiEval = yield AIEvaluation_modal_1.default.create({
                sheetId,
                studentId,
                examId,
                classId: sheet.classId || "",
                subjectId: sheet.subjectId || "",
                examType: sheet.examType || "",
                section: sheet.section || "",
                status: "Pending",
                totalScore: 0,
                evaluations: [],
            });
        }
        else {
            yield aiEval.update({
                status: "Pending",
                error: undefined,
            });
        }
        // 5. Fire Async Pipeline 6.3 Background Job
        runBackgroundPipeline6Evaluation(sheet, aiEval, studentId, examId, maxMarks, questionText, standardAnsText).catch((err) => {
            logger_1.default.error("[Pipeline6 Service] Background evaluation job failed:", err);
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Pipeline 6.3 AI evaluation triggered successfully.",
            data: aiEval,
        };
    }
    catch (error) {
        logger_1.default.error("[Pipeline6 Service] Initialization failed:", error);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Failed to initialize Pipeline 6.3 evaluation: ${error.message}`,
        };
    }
});
exports.triggerPipeline6Evaluation = triggerPipeline6Evaluation;
// ─── Background Execution: Parallel Student OCR + Rubric Pre-warming + Pipeline 6 ────────
const runBackgroundPipeline6Evaluation = (sheet, aiEval, studentId, examId, maxMarks, questionText, standardAnsText) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ocrApiUrl = pythonServices_1.pythonServices.ocrUrl();
        const pipeline6Url = pythonServices_1.pythonServices.pipeline6Url();
        const preprocessUrl = pythonServices_1.pythonServices.pipeline6PreprocessUrl();
        // ⚡ 1. PARALLEL THREADS
        // Thread 1: Student Answer Sheet OCR (Port 8000)
        const studentOcrTask = (() => __awaiter(void 0, void 0, void 0, function* () {
            var _a;
            let studentAnsText = sheet.ocrText || sheet.answerText || "";
            if (!studentAnsText && sheet.fileBuffer && sheet.fileBuffer.length > 0) {
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
                logger_1.default.info(`[Pipeline6 Service] [Thread 1] Sending student answer sheet (${fileName}, ${sheet.fileBuffer.length} bytes) to OCR API: ${ocrApiUrl}`);
                const ocrResponse = yield axios_1.default.post(ocrApiUrl, ocrFormData, {
                    headers: ocrFormData.getHeaders(),
                    timeout: 3600000,
                });
                studentAnsText = ((_a = ocrResponse.data) === null || _a === void 0 ? void 0 : _a.combined_markdown) || "";
                logger_1.default.info(`[Pipeline6 Service] [Thread 1] Student answer OCR completed (${studentAnsText.length} chars).`);
            }
            return studentAnsText;
        }))();
        // Thread 2: Answer Key OCR (if file) & Pre-warming Rubric Cache on Pipeline 6 (Port 8007)
        const answerKeyAndRubricTask = (() => __awaiter(void 0, void 0, void 0, function* () {
            var _b;
            let finalAnswerKeyText = standardAnsText;
            if (standardAnsText &&
                (standardAnsText.startsWith("http://") ||
                    standardAnsText.startsWith("https://") ||
                    /\.(pdf|png|jpg|jpeg|webp)$/i.test(standardAnsText.trim()))) {
                try {
                    logger_1.default.info(`[Pipeline6 Service] [Thread 2] Answer key is a file URL/path. Running OCR: ${standardAnsText}`);
                    const ansKeyFileRes = yield axios_1.default.get(standardAnsText.trim(), { responseType: "arraybuffer" });
                    const ansKeyFormData = new form_data_1.default();
                    ansKeyFormData.append("file", ansKeyFileRes.data, "answer_key" + (standardAnsText.slice(standardAnsText.lastIndexOf(".")) || ".pdf"));
                    const ansKeyOcrRes = yield axios_1.default.post(ocrApiUrl, ansKeyFormData, {
                        headers: ansKeyFormData.getHeaders(),
                        timeout: 3600000,
                    });
                    if ((_b = ansKeyOcrRes.data) === null || _b === void 0 ? void 0 : _b.combined_markdown) {
                        finalAnswerKeyText = ansKeyOcrRes.data.combined_markdown;
                        logger_1.default.info("[Pipeline6 Service] [Thread 2] Answer Key OCR completed successfully.");
                    }
                }
                catch (ansKeyOcrErr) {
                    logger_1.default.error("[Pipeline6 Service] [Thread 2] Answer Key OCR failed, using original string:", ansKeyOcrErr.message);
                }
            }
            // Pre-warm Exam Rubric Cache on Pipeline 6 (Port 8007)
            if (questionText && finalAnswerKeyText) {
                try {
                    logger_1.default.info(`[Pipeline6 Service] [Thread 2] Pre-warming rubric cache on Pipeline 6: ${preprocessUrl}`);
                    yield axios_1.default.post(preprocessUrl, {
                        exam_id: examId,
                        question_paper_text: questionText,
                        answer_key_text: finalAnswerKeyText,
                        max_marks: maxMarks,
                    }, { timeout: 30000 });
                    logger_1.default.info("[Pipeline6 Service] [Thread 2] Rubric cache pre-warmed successfully.");
                }
                catch (err) {
                    logger_1.default.warn(`[Pipeline6 Service] [Thread 2] Rubric pre-warming notification warning (will infer on demand): ${err.message}`);
                }
            }
            return finalAnswerKeyText;
        }))();
        // 🚀 AWAIT BOTH PARALLEL THREADS
        const [studentAnsOcr, finalAnswerKeyText] = yield Promise.all([studentOcrTask, answerKeyAndRubricTask]);
        // 2. Dispatch Payload to Pipeline 6.3 Evaluation Endpoint (Port 8007)
        const pipelinePayload = {
            student_id: studentId,
            exam_id: examId,
            question_paper_text: questionText,
            answer_key_text: finalAnswerKeyText,
            student_answer_text: studentAnsOcr || "No student answer text available.",
            max_marks: maxMarks,
        };
        logger_1.default.info(`[Pipeline6 Service] Posting payload to Pipeline 6.3 endpoint: ${pipeline6Url}`);
        const evalResponse = yield axios_1.default.post(pipeline6Url, pipelinePayload, {
            headers: { "Content-Type": "application/json" },
            timeout: 3600000, // 1 hour
        });
        const evalResult = evalResponse.data;
        logger_1.default.info("[Pipeline6 Service] Pipeline 6.3 evaluation completed successfully.");
        console.log("==================== PIPELINE 6.3 RESPONSE ====================");
        console.log(JSON.stringify(evalResult, null, 2));
        console.log("===============================================================");
        // 3. Map Pipeline 6.3 response to clean AIEvaluation DB schema
        const rawQuestions = evalResult.questions || evalResult.evaluations || [];
        const mappedQuestions = rawQuestions.map((q) => {
            var _a, _b, _c;
            return ({
                questionId: q.questionId || q.question_id || "",
                questionText: q.questionText || q.question_text || q.question || "",
                studentAnswer: q.studentAnswer || q.student_answer_snippet || "",
                expectedAnswer: q.expectedAnswer || "",
                marks: q.marks || {
                    obtained: q.obtainedMarks !== undefined ? q.obtainedMarks : (q.score || 0),
                    maximum: q.maxMarks !== undefined ? q.maxMarks : (q.max_marks || 0),
                },
                status: q.status || "Incorrect",
                evaluation: q.evaluation || {
                    confidence: typeof q.confidence === "object" ? q.confidence : {
                        score: q.confidence !== undefined ? q.confidence : 1.0,
                        reason: "Evaluated by Pipeline 6.3 multi-agent engine"
                    },
                    reasoning: typeof q.reasoning === "object" ? q.reasoning : {
                        analysis: q.reasoning || q.feedback || "",
                        comparison: {
                            student: q.studentAnswer || "",
                            expected: q.expectedAnswer || "",
                        },
                        conceptsIdentified: q.strengths || [],
                        missingConcepts: q.missingConcepts || q.missing_concepts || [],
                        markJustification: `Awarded ${q.obtainedMarks || q.score || 0} marks based on answer analysis.`
                    },
                    feedback: typeof q.feedback === "string" ? q.feedback : (((_a = q.feedback) === null || _a === void 0 ? void 0 : _a.overall) || "Evaluated"),
                    strengths: q.strengths || [],
                    improvements: q.missingConcepts || q.missing_concepts || [],
                    keywords: {
                        matched: q.keywordsMatched || ((_b = q.keywords) === null || _b === void 0 ? void 0 : _b.matched) || [],
                        missing: q.keywordsMissing || ((_c = q.keywords) === null || _c === void 0 ? void 0 : _c.missing) || [],
                    }
                }
            });
        });
        const totalObtainedScore = evalResult.summary ? evalResult.summary.obtainedMarks : (evalResult.total_score || 0);
        // 4. Update AIEvaluation Details in Database
        yield aiEval.update({
            status: "Success",
            totalScore: totalObtainedScore,
            feedback: typeof evalResult.feedback === "object" ? (evalResult.feedback.overall || JSON.stringify(evalResult.feedback)) : (evalResult.feedback || ""),
            evaluations: mappedQuestions,
            summary: evalResult.summary || null,
            metadata: evalResult.metadata || null,
            studentAnsOcr: studentAnsOcr,
            standardAnsOcr: finalAnswerKeyText,
            questionOcr: questionText,
            error: null,
        });
        // 5. Update Scanner Sheet status to Evaluated
        yield sheet.update({ status: "Evaluated" });
        logger_1.default.info(`[Pipeline6 Service] Successfully completed and saved evaluation for sheet: ${sheet.sheetId}`);
    }
    catch (error) {
        logger_1.default.error(`[Pipeline6 Service] Evaluation background job failed for sheet ${sheet.sheetId}:`, error);
        yield aiEval.update({
            status: "Failed",
            error: error.message || "Unknown error occurred during background Pipeline 6.3 AI evaluation.",
        });
    }
});
exports.default = {
    triggerPipeline6Evaluation: exports.triggerPipeline6Evaluation,
};
