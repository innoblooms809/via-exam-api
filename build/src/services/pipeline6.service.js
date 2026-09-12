"use strict";
// ─── Pipeline 6 — main AI evaluation ────────────────────────────────────────────
//
// Every evaluation request goes through ONE in-process, two-stage job queue:
//
//   trigger ──► [ Stage 1: OCR :8000  ‖  AI diagram pre-scan :8006 ] ──► [ Stage 2: AI evaluation :8006 ] ──► saved
//
// • Queue: each stage works on at most N sheets at a time (EVAL_QUEUE_OCR_CONCURRENCY /
//   EVAL_QUEUE_EVAL_CONCURRENCY, default 1). Other sheets wait in FIFO order, so a
//   batch of "Evaluate All" never floods the Python servers.
// • Parallel workflow:
//     – within a sheet: OCR reads the text while the AI already pre-scans the
//       diagrams/handwriting from the PDF (/visual-pre-eval, cached for /evaluate-text);
//     – across sheets: while the AI evaluates student 1, OCR is already reading student 2.
// • A sheet is never queued twice; asking again returns its current place in line.
// • Uploaded (PDF) model answers are OCR-ed ONCE and saved (answerKeyOcr.service),
//   then reused for every student instead of being OCR-ed per student.
// • The student's original file is sent along with the OCR text, so when the OCR
//   is weak or answer mapping fails, pipeline6.py can fall back to reading the
//   whole sheet (page images) and map the answers itself.
// • Jobs still "Pending" after a server restart are put back in the queue on start.
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
exports.recoverPipeline6Queue = exports.triggerPipeline6Evaluation = exports.getQueueSnapshot = exports.getSheetQueueInfo = void 0;
const http_status_1 = __importDefault(require("http-status"));
const sequelize_1 = require("sequelize");
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const stander_answer_model_1 = __importDefault(require("../modals/question-paper/stander-answer.model"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const logger_1 = __importDefault(require("../config/logger"));
const axios_1 = __importDefault(require("axios"));
const pythonServices_1 = require("../config/pythonServices");
const questionPaperText_1 = require("../utils/questionPaperText");
const answerKeyOcr_service_1 = require("./answerKeyOcr.service");
const EVAL_TIMEOUT_MS = 3600000; // 1 hour — CPU inference on long papers is slow
const positiveInt = (value, fallback) => {
    const n = Number.parseInt(String(value !== null && value !== void 0 ? value : ""), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
// ─── Stage queue ────────────────────────────────────────────────────────────────
/** A FIFO queue that runs at most `concurrency` jobs of one stage at a time. */
class StageQueue {
    constructor(name, concurrency, work) {
        this.name = name;
        this.concurrency = concurrency;
        this.work = work;
        this.waiting = [];
        this.running = new Map();
    }
    push(job) {
        this.waiting.push(job);
        this.pump();
    }
    has(sheetId) {
        return this.running.has(sheetId) || this.waiting.some((j) => j.sheetId === sheetId);
    }
    isRunning(sheetId) {
        return this.running.has(sheetId);
    }
    /** 1-based place in the waiting line, or 0 when not waiting. */
    position(sheetId) {
        return this.waiting.findIndex((j) => j.sheetId === sheetId) + 1;
    }
    counts() {
        return { running: this.running.size, waiting: this.waiting.length };
    }
    // Start as many waiting jobs as the concurrency limit allows; each finished job
    // frees its slot and pulls in the next one.
    pump() {
        while (this.running.size < this.concurrency && this.waiting.length > 0) {
            const job = this.waiting.shift();
            this.running.set(job.sheetId, job);
            this.work(job)
                .catch((err) => logger_1.default.error(`[Pipeline6 Queue] ${this.name} stage crashed for sheet ${job.sheetId}:`, err))
                .finally(() => {
                this.running.delete(job.sheetId);
                this.pump();
            });
        }
    }
}
/** Marks the sheet's evaluation as failed with a readable reason. */
function failJob(sheetId, stage, err) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const message = ((_b = (_a = err === null || err === void 0 ? void 0 : err.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.detail) || (err === null || err === void 0 ? void 0 : err.message) || "Unknown error";
        logger_1.default.error(`[Pipeline6] ${stage} failed for sheet ${sheetId}: ${message}`);
        yield AIEvaluation_modal_1.default.update({ status: "Failed", error: `${stage} failed: ${message}` }, { where: { sheetId } }).catch(() => undefined);
    });
}
// ─── Stage 1: OCR (port 8000) ‖ AI diagram pre-scan (port 8006) ─────────────────
//
// When a sheet's turn comes, two things start AT THE SAME TIME (as in the earlier
// V2 flow):
//   • OCR reads the student's written text                      → ocr_server.py :8000
//   • the AI pre-scans the diagrams / handwriting in the PDF    → pipeline6.py /visual-pre-eval
//     (results are cached in pipeline6.py and reused by /evaluate-text)
// This stage ends as soon as OCR is done, so the OCR server moves straight on to
// the next sheet; the AI stage waits only for THIS sheet's pre-scan before it runs.
function readStudentSheet(job, sheet) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        let studentText = String(sheet.ocrText || sheet.answerText || "");
        if (!studentText && ((_a = sheet.fileBuffer) === null || _a === void 0 ? void 0 : _a.length)) {
            let fileName = sheet.fileName || "sheet.png";
            if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
                fileName += sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
            }
            logger_1.default.info(`[Pipeline6] [OCR] Reading student sheet ${job.sheetId} (${fileName}, ${sheet.fileBuffer.length} bytes)`);
            studentText = yield (0, answerKeyOcr_service_1.ocrDocument)(sheet.fileBuffer, fileName, sheet.fileMimeType || "image/png");
        }
        return studentText;
    });
}
/** AI pre-scan of diagrams/handwriting from the student's file. Only logs on failure —
 *  /evaluate-text then evaluates the diagrams itself. */
function runVisualPreEval(job, sheet, answerKeyText) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        if (!((_a = sheet.fileBuffer) === null || _a === void 0 ? void 0 : _a.length))
            return;
        const started = Date.now();
        try {
            logger_1.default.info(`[Pipeline6] [AI pre-scan] Scanning diagrams of sheet ${job.sheetId} while OCR runs`);
            yield axios_1.default.post(pythonServices_1.pythonServices.pipeline6VisualPreEvalUrl(), {
                student_id: job.studentId,
                exam_id: job.examId,
                question_paper_text: job.questionText,
                answer_key_text: answerKeyText,
                student_pdf_base64: sheet.fileBuffer.toString("base64"),
                max_marks: job.maxMarks,
            }, {
                headers: { "Content-Type": "application/json" },
                // Can wait behind another sheet's evaluation on the same AI server.
                timeout: EVAL_TIMEOUT_MS,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            logger_1.default.info(`[Pipeline6] [AI pre-scan] Sheet ${job.sheetId} pre-scanned in ${Math.round((Date.now() - started) / 1000)}s`);
        }
        catch (err) {
            logger_1.default.warn(`[Pipeline6] [AI pre-scan] Sheet ${job.sheetId} skipped (evaluation will scan diagrams itself): ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
        }
    });
}
function runOcrStage(job) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sheet = yield Scanner_modal_1.default.findOne({ where: { sheetId: job.sheetId, isDeleted: false } });
            if (!sheet)
                throw new Error("Scanner sheet not found.");
            // Model answer first (the pre-scan needs it): typed answers as-is; an uploaded
            // file comes from its saved OCR text (OCR-ed only the first time, then cached).
            let answerKeyText = job.typedAnswerKey;
            if (!answerKeyText && job.answerKeyFileAnswerId) {
                answerKeyText = (_a = (yield (0, answerKeyOcr_service_1.getAnswerKeyText)(job.answerKeyFileAnswerId))) !== null && _a !== void 0 ? _a : "";
            }
            job.answerKeyText = answerKeyText;
            // ⚡ In parallel: AI pre-scan (8006) runs while OCR (8000) reads the text.
            job.visualPreEval = runVisualPreEval(job, sheet, answerKeyText);
            const studentText = yield readStudentSheet(job, sheet);
            // Empty/weak OCR is NOT a failure: stage 2 sends the original file too, and
            // pipeline6.py reads the whole sheet from its page images in that case.
            logger_1.default.info(`[Pipeline6] [OCR] Sheet ${job.sheetId}: ${studentText.length} chars of student text.`);
            job.studentText = studentText;
            evaluationQueue.push(job); // hand over to the AI stage; OCR moves on to the next sheet
        }
        catch (err) {
            yield failJob(job.sheetId, "OCR", err);
        }
    });
}
// ─── Stage 2: AI evaluation (port 8006) ─────────────────────────────────────────
function runEvaluationStage(job) {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const sheet = yield Scanner_modal_1.default.findOne({ where: { sheetId: job.sheetId, isDeleted: false } });
            const aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId: job.sheetId } });
            if (!sheet || !aiEval)
                throw new Error("Sheet or evaluation record no longer exists.");
            // Let this sheet's diagram pre-scan finish, so /evaluate-text reuses its cached
            // results instead of scanning the diagrams a second time.
            if (job.visualPreEval)
                yield job.visualPreEval;
            const payload = {
                student_id: job.studentId,
                exam_id: job.examId,
                question_paper_text: job.questionText,
                answer_key_text: job.answerKeyText || "",
                student_answer_text: job.studentText || "",
                max_marks: job.maxMarks,
                // Original sheet: pipeline6.py uses its page images for diagram questions and
                // for the whole-sheet fallback when OCR confidence is low / mapping fails.
                student_pdf_base64: ((_a = sheet.fileBuffer) === null || _a === void 0 ? void 0 : _a.length) ? sheet.fileBuffer.toString("base64") : undefined,
            };
            logger_1.default.info(`[Pipeline6] [AI] Evaluating sheet ${job.sheetId} on ${pythonServices_1.pythonServices.pipeline6Url()}`);
            const evalResponse = yield axios_1.default.post(pythonServices_1.pythonServices.pipeline6Url(), payload, {
                headers: { "Content-Type": "application/json" },
                timeout: EVAL_TIMEOUT_MS,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            const evalResult = evalResponse.data;
            // Map the pipeline response to the AIEvaluation DB schema.
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
                            reason: "Evaluated by Pipeline 6.3 multi-agent engine",
                        },
                        reasoning: typeof q.reasoning === "object" ? q.reasoning : {
                            analysis: q.reasoning || q.feedback || "",
                            comparison: { student: q.studentAnswer || "", expected: q.expectedAnswer || "" },
                            conceptsIdentified: q.strengths || [],
                            missingConcepts: q.missingConcepts || q.missing_concepts || [],
                            markJustification: `Awarded ${q.obtainedMarks || q.score || 0} marks based on answer analysis.`,
                        },
                        feedback: typeof q.feedback === "string" ? q.feedback : (((_a = q.feedback) === null || _a === void 0 ? void 0 : _a.overall) || "Evaluated"),
                        strengths: q.strengths || [],
                        improvements: q.missingConcepts || q.missing_concepts || [],
                        keywords: {
                            matched: q.keywordsMatched || ((_b = q.keywords) === null || _b === void 0 ? void 0 : _b.matched) || [],
                            missing: q.keywordsMissing || ((_c = q.keywords) === null || _c === void 0 ? void 0 : _c.missing) || [],
                        },
                    },
                });
            });
            const totalObtainedScore = evalResult.summary ? evalResult.summary.obtainedMarks : (evalResult.total_score || 0);
            yield aiEval.update({
                status: "Success",
                totalScore: totalObtainedScore,
                feedback: typeof evalResult.feedback === "object"
                    ? (evalResult.feedback.overall || JSON.stringify(evalResult.feedback))
                    : (evalResult.feedback || ""),
                evaluations: mappedQuestions,
                studentAnsOcr: job.studentText || "",
                standardAnsOcr: job.answerKeyText || "",
                questionOcr: job.questionText,
                error: null,
            });
            yield sheet.update({ status: "Evaluated" });
            const waitedSeconds = Math.round((Date.now() - job.queuedAt) / 1000);
            logger_1.default.info(`[Pipeline6] [AI] Sheet ${job.sheetId} evaluated: ${totalObtainedScore} marks (${waitedSeconds}s since queued).`);
        }
        catch (err) {
            yield failJob(job.sheetId, "AI evaluation", err);
        }
    });
}
// One OCR worker and one AI worker by default — raise only if the servers have headroom.
const ocrQueue = new StageQueue("OCR", positiveInt(process.env.EVAL_QUEUE_OCR_CONCURRENCY, 1), runOcrStage);
const evaluationQueue = new StageQueue("AI evaluation", positiveInt(process.env.EVAL_QUEUE_EVAL_CONCURRENCY, 1), runEvaluationStage);
/** Where a sheet currently is in the queue, or null when it is not queued. */
function getSheetQueueInfo(sheetId) {
    if (ocrQueue.isRunning(sheetId))
        return { stage: "ocr", position: 0 };
    if (evaluationQueue.isRunning(sheetId))
        return { stage: "evaluating", position: 0 };
    const ocrPos = ocrQueue.position(sheetId);
    if (ocrPos)
        return { stage: "waiting_for_ocr", position: ocrPos };
    const evalPos = evaluationQueue.position(sheetId);
    if (evalPos)
        return { stage: "waiting_for_evaluation", position: evalPos };
    return null;
}
exports.getSheetQueueInfo = getSheetQueueInfo;
function getQueueSnapshot() {
    return { ocr: ocrQueue.counts(), evaluation: evaluationQueue.counts() };
}
exports.getQueueSnapshot = getQueueSnapshot;
const isQueued = (sheetId) => ocrQueue.has(sheetId) || evaluationQueue.has(sheetId);
// ─── Trigger (enqueue) ──────────────────────────────────────────────────────────
const triggerPipeline6Evaluation = (sheetId, force = false) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sheet = (yield Scanner_modal_1.default.findOne({ where: { sheetId, isDeleted: false } })) || (yield Scanner_modal_1.default.findByPk(sheetId));
        if (!sheet) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Scanner sheet not found." };
        }
        sheetId = sheet.sheetId;
        let aiEval = yield AIEvaluation_modal_1.default.findOne({ where: { sheetId } });
        // Already in line: never queue the same sheet twice.
        if (isQueued(sheetId)) {
            return {
                error: false,
                statusCode: http_status_1.default.OK,
                message: "This sheet is already queued for evaluation.",
                data: aiEval ? Object.assign(Object.assign({}, aiEval.get({ plain: true })), { queue: getSheetQueueInfo(sheetId) }) : null,
            };
        }
        if (aiEval && aiEval.status === "Success" && !force) {
            return { error: false, statusCode: http_status_1.default.OK, message: "Sheet already evaluated.", data: aiEval };
        }
        // ── Resolve student, exam, question paper and model answer ──
        const student = yield Student_modal_1.default.findOne({
            where: { rollNumber: sheet.rollNo, instituteId: sheet.instituteId, classId: sheet.classId },
        });
        const studentId = student ? student.userId : (sheet.studentId || `STUDENT-${sheet.rollNo}`);
        let examId = sheet.examType || "EXAM-1";
        let maxMarks = 10;
        let questionText = "Evaluate student answer sheet.";
        let typedAnswerKey = "";
        let answerKeyFileAnswerId = null;
        const exam = yield Exam_modal_1.default.findOne({
            where: { instituteId: sheet.instituteId, classId: sheet.classId, subjectId: sheet.subjectId, examType: sheet.examType, isDeleted: false },
            order: [["createdAt", "DESC"]],
        });
        if (exam) {
            examId = exam.examId;
            maxMarks = exam.totalMarks || 10;
            const targetPaperSet = sheet.section || "A";
            const questionPaper = (yield QuestionPaper_modal_1.default.findOne({
                where: { examId: exam.examId, instituteId: sheet.instituteId, paperSet: targetPaperSet },
                order: [["createdAt", "DESC"]],
            })) || (yield QuestionPaper_modal_1.default.findOne({
                // Set not found: prefer an approved set of the exam over a draft one.
                where: { examId: exam.examId, instituteId: sheet.instituteId, status: { [sequelize_1.Op.in]: ["APPROVED", "PUBLISHED"] } },
                order: [["paperSet", "ASC"]],
            })) || (yield QuestionPaper_modal_1.default.findOne({
                where: { examId: exam.examId, instituteId: sheet.instituteId },
                order: [["createdAt", "DESC"]],
            }));
            if (questionPaper) {
                const qpAnswer = (yield stander_answer_model_1.default.findOne({
                    where: { paperId: questionPaper.paperId, paperSet: questionPaper.paperSet },
                })) || (yield stander_answer_model_1.default.findOne({
                    where: { paperId: questionPaper.paperId },
                })) || (yield stander_answer_model_1.default.findOne({
                    // Answer sheet kept from an earlier (deleted) paper of the same set.
                    where: { examId: questionPaper.examId, paperSet: questionPaper.paperSet },
                    order: [["updatedAt", "DESC"]],
                }));
                const { questions, answers, calculatedTotalMarks, answerKeyFileUrl } = (0, questionPaperText_1.formatQuestionPaper)(questionPaper.content, qpAnswer ? qpAnswer.answers : null);
                if (questions)
                    questionText = questions;
                if (answers)
                    typedAnswerKey = answers;
                else if (answerKeyFileUrl && qpAnswer)
                    answerKeyFileAnswerId = qpAnswer.answerId; // uploaded model answer
                if (calculatedTotalMarks > 0)
                    maxMarks = calculatedTotalMarks;
            }
        }
        // ── Evaluation record → Pending (the queue page polls this) ──
        if (!aiEval) {
            aiEval = yield AIEvaluation_modal_1.default.create({
                evaluationId: yield helper_1.default.generateUserId(),
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
            yield aiEval.update({ status: "Pending", error: null });
        }
        ocrQueue.push({
            sheetId,
            studentId,
            examId,
            maxMarks,
            questionText,
            typedAnswerKey,
            answerKeyFileAnswerId,
            queuedAt: Date.now(),
        });
        const queue = getSheetQueueInfo(sheetId);
        logger_1.default.info(`[Pipeline6] Sheet ${sheetId} queued (${queue === null || queue === void 0 ? void 0 : queue.stage}, #${queue === null || queue === void 0 ? void 0 : queue.position}).`);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: (queue === null || queue === void 0 ? void 0 : queue.stage) === "waiting_for_ocr"
                ? `Queued for AI evaluation (position ${queue.position}).`
                : "AI evaluation started.",
            data: Object.assign(Object.assign({}, aiEval.get({ plain: true })), { queue }),
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
// ─── Restart recovery ───────────────────────────────────────────────────────────
/**
 * The queue lives in memory, so a restart drops it. Evaluations left "Pending"
 * (queued or mid-way) in the last 24 hours are put back in line on startup.
 * Disable with EVAL_QUEUE_RECOVER_ON_START=false.
 */
function recoverPipeline6Queue() {
    var _a;
    return __awaiter(this, void 0, void 0, function* () {
        if (String((_a = process.env.EVAL_QUEUE_RECOVER_ON_START) !== null && _a !== void 0 ? _a : "true").toLowerCase() === "false")
            return;
        try {
            const stuck = yield AIEvaluation_modal_1.default.findAll({
                where: { status: "Pending", updatedAt: { [sequelize_1.Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
                order: [["updatedAt", "ASC"]],
            });
            for (const row of stuck) {
                yield (0, exports.triggerPipeline6Evaluation)(row.sheetId, true);
            }
            if (stuck.length)
                logger_1.default.info(`[Pipeline6 Queue] Re-queued ${stuck.length} evaluation(s) left pending before restart.`);
        }
        catch (err) {
            logger_1.default.warn(`[Pipeline6 Queue] Could not recover pending evaluations: ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
        }
    });
}
exports.recoverPipeline6Queue = recoverPipeline6Queue;
exports.default = {
    triggerPipeline6Evaluation: exports.triggerPipeline6Evaluation,
    getSheetQueueInfo,
    getQueueSnapshot,
    recoverPipeline6Queue,
};
