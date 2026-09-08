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
const logger_1 = __importDefault(require("../config/logger"));
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
// ─── Helper: Format question paper content into plain text ────────────────────
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
// ─── TRIGGER EVALUATION V2 (OCR Pipeline on port 8002) ──────────────────────
const triggerEvaluationV2 = (sheetId, force = false) => __awaiter(void 0, void 0, void 0, function* () {
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
            if (timeElapsed < 180000) {
                // 3 minutes
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
            // ─── Paper Set Matching (same logic as V1) ─────────────────────────────────
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
                logger_1.default.info(`[V2] No QuestionPaper found for examId '${exam.examId}' and paperSet '${targetPaperSet}'. Fetching latest QuestionPaper.`);
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
                const { questions, answers } = formatQuestionPaper(questionPaper.content, ansDoc);
                if (questions)
                    questionText = questions;
                if (answers)
                    standardAnsText = answers;
            }
        }
        // 5. Run evaluation asynchronously in the background using the NEW pipeline
        runBackgroundEvaluationV2(sheet, aiEval, studentId, examId, maxMarks, questionText, standardAnsText).catch((err) => {
            logger_1.default.error("Background evaluation V2 trigger failed:", err);
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "AI evaluation (v2 pipeline) triggered successfully.",
            data: aiEval,
        };
    }
    catch (error) {
        console.error("AI Evaluation V2 initialization failed:", error);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Failed to initialize evaluation: ${error.message}`,
        };
    }
});
// ─── Background: Parallel OCR + Pipeline Evaluation (TESTING & PRODUCTION CONFIG) ─────────
// // TESTING & PRODUCTION CONFIGURATION:
// // Executes Student Sheet OCR (Port 8000) and Answer Key OCR / Rubric Pre-warming (Port 8007)
// // in parallel using Promise.all for maximum speed on high-spec servers.
const runBackgroundEvaluationV2 = (sheet, aiEval, studentId, examId, maxMarks, questionText, standardAnsText) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ocrApiUrl = process.env.OCR_API_URL || "http://localhost:8000/ocrOutput";
        // ⚡ 1. PARALLEL EXECUTION THREADS
        // Thread 1: Student Answer Sheet OCR (Port 8000)
        const studentOcrTask = (() => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b;
            try {
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
                logger_1.default.info(`[V2] [Thread 1] Sending student answer sheet (${fileName}, ${sheet.fileBuffer.length} bytes) to OCR API: ${ocrApiUrl}`);
                const ocrResponse = yield axios_1.default.post(ocrApiUrl, ocrFormData, {
                    headers: ocrFormData.getHeaders(),
                    timeout: 3600000,
                });
                const studentAnsOcr = ((_a = ocrResponse.data) === null || _a === void 0 ? void 0 : _a.combined_markdown) || "";
                logger_1.default.info("[V2] [Thread 1] Student answer OCR completed successfully.");
                return studentAnsOcr;
            }
            catch (ocrErr) {
                logger_1.default.error(`[V2] [Thread 1] Student Answer Sheet OCR failed (${ocrApiUrl}): ${ocrErr.message}`, ((_b = ocrErr.response) === null || _b === void 0 ? void 0 : _b.data) || ocrErr.code);
                return "";
            }
        }))();
        // Thread 2: Answer Key OCR (if needed) & Pre-warming Rubric Cache on Port 8007
        const answerKeyAndRubricTask = (() => __awaiter(void 0, void 0, void 0, function* () {
            var _c;
            let finalAnswerKeyText = standardAnsText;
            if (standardAnsText &&
                (standardAnsText.startsWith("http://") ||
                    standardAnsText.startsWith("https://") ||
                    /\.(pdf|png|jpg|jpeg|webp)$/i.test(standardAnsText.trim()))) {
                try {
                    logger_1.default.info(`[V2] [Thread 2] Answer key is a file URL/path. Running OCR: ${standardAnsText}`);
                    const ansKeyFileRes = yield axios_1.default.get(standardAnsText.trim(), { responseType: "arraybuffer" });
                    const ansKeyBlob = new Blob([ansKeyFileRes.data]);
                    const ansKeyFormData = new form_data_1.default();
                    ansKeyFormData.append("file", ansKeyBlob, "answer_key" + (standardAnsText.slice(standardAnsText.lastIndexOf(".")) || ".pdf"));
                    const ansKeyOcrRes = yield axios_1.default.post(ocrApiUrl, ansKeyFormData, { timeout: 3600000 });
                    if ((_c = ansKeyOcrRes.data) === null || _c === void 0 ? void 0 : _c.combined_markdown) {
                        finalAnswerKeyText = ansKeyOcrRes.data.combined_markdown;
                        logger_1.default.info("[V2] [Thread 2] Answer Key OCR completed successfully.");
                    }
                }
                catch (ansKeyOcrErr) {
                    logger_1.default.error("[V2] [Thread 2] Answer Key OCR failed, using original string:", ansKeyOcrErr.message);
                }
            }
            // Pre-warm Rubric Cache on Pipeline (Port 8006) in parallel
            if (questionText && finalAnswerKeyText) {
                try {
                    const preprocessUrl = process.env.PIPELINE6_PREPROCESS_URL || "http://localhost:8006/preprocess-exam";
                    logger_1.default.info(`[V2] [Thread 2] Pre-warming rubric cache on Pipeline: ${preprocessUrl}`);
                    yield axios_1.default.post(preprocessUrl, {
                        exam_id: examId,
                        question_paper_text: questionText,
                        answer_key_text: finalAnswerKeyText,
                        max_marks: maxMarks,
                    }, { timeout: 30000 });
                    logger_1.default.info("[V2] [Thread 2] Rubric cache pre-warmed successfully.");
                }
                catch (err) {
                    logger_1.default.warn(`[V2] [Thread 2] Rubric pre-warming notification warning (will infer on demand): ${err.message}`);
                }
            }
            return finalAnswerKeyText;
        }))();
        // Thread 3: Parallel Visual Pre-Evaluation Task (Port 8006 — Runs parallel to Chandra OCR!)
        const visualPreEvalTask = (() => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const visualPreEvalUrl = process.env.PIPELINE6_VISUAL_PREEVAL_URL || "http://localhost:8006/visual-pre-eval";
                logger_1.default.info(`[V2] [Thread 3] Launching Parallel Visual Pre-Evaluation on Pipeline: ${visualPreEvalUrl}`);
                const pdfBase64 = sheet.fileBuffer ? sheet.fileBuffer.toString("base64") : undefined;
                yield axios_1.default.post(visualPreEvalUrl, {
                    student_id: studentId,
                    exam_id: examId,
                    question_paper_text: questionText,
                    answer_key_text: standardAnsText,
                    student_pdf_base64: pdfBase64,
                    max_marks: maxMarks,
                }, { timeout: 120000 });
                logger_1.default.info("[V2] [Thread 3] Parallel Visual Pre-Evaluation completed/cached successfully.");
            }
            catch (err) {
                logger_1.default.warn(`[V2] [Thread 3] Visual pre-evaluation notification warning (will infer on demand): ${err.message}`);
            }
        }))();
        // 🚀 AWAIT ALL THREADS IN PARALLEL
        const [studentAnsOcr, finalAnswerKeyText] = yield Promise.all([
            studentOcrTask,
            answerKeyAndRubricTask,
            visualPreEvalTask,
        ]);
        // 2. Call evaluation pipeline on port 8006 (/evaluate-text)
        const pipelineUrl = process.env.OCR_PIPELINE_URL || "http://localhost:8006/evaluate-text";
        const pdfBase64 = sheet.fileBuffer ? sheet.fileBuffer.toString("base64") : undefined;
        const pipelinePayload = {
            student_id: studentId,
            exam_id: examId,
            question_paper_text: questionText,
            answer_key_text: finalAnswerKeyText,
            student_answer_text: studentAnsOcr,
            max_marks: maxMarks,
            student_pdf_base64: pdfBase64,
        };
        logger_1.default.info(`[V2] Sending extracted text to Pipeline on port 8006: ${pipelineUrl}`);
        const evalResponse = yield axios_1.default.post(pipelineUrl, pipelinePayload, {
            headers: { "Content-Type": "application/json" },
            timeout: 3600000, // 1 hour
        });
        const evalResult = evalResponse.data;
        logger_1.default.info("[V2] Pipeline v6.3 evaluation completed successfully.");
        console.log("==================== AI PIPELINE RESPONSE ====================");
        console.log(JSON.stringify(evalResult, null, 2));
        console.log("==============================================================");
        // 3. Map pipeline response to clean AIEvaluation DB schema without duplication
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
                        reason: "Evaluated by AI pipeline"
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
        // 4. Save Successful Evaluation Details
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
        console.log("==================== SAVED DB EVALUATION ====================");
        console.log(JSON.stringify({
            status: "Success",
            totalScore: totalObtainedScore,
            summary: evalResult.summary,
            questionsCount: mappedQuestions.length,
            evaluationsSample: mappedQuestions[0]
        }, null, 2));
        console.log("=============================================================");
        // 5. Update Scanner sheet status to Evaluated
        yield sheet.update({ status: "Evaluated" });
    }
    catch (error) {
        logger_1.default.error(`[V2] AI Evaluation background job failed for sheet ${sheet.sheetId}:`, error);
        // Update status as Failed
        yield aiEval.update({
            status: "Failed",
            error: error.message ||
                "Unknown error occurred during background AI evaluation (v2).",
        });
    }
});
exports.default = {
    triggerEvaluationV2,
};
