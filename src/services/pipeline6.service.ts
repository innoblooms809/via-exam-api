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

import httpStatus from "http-status";
import { Op } from "sequelize";
import Scanner from "../modals/Scanner.modal";
import Exam from "../modals/Exam.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import RegHelper from "../utils/helper";
import logger from "../config/logger";
import axios from "axios";
import { pythonServices } from "../config/pythonServices";
import { formatQuestionPaper } from "../utils/questionPaperText";
import { getAnswerKeyText, ocrDocument } from "./answerKeyOcr.service";

const EVAL_TIMEOUT_MS = 3600000; // 1 hour — CPU inference on long papers is slow

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// ─── Job ────────────────────────────────────────────────────────────────────────

/** Everything needed to evaluate one student sheet, resolved when it is queued. */
interface EvaluationJob {
  sheetId: string;
  studentId: string;
  examId: string;
  maxMarks: number;
  questionText: string;
  /** Typed model answers ("1. Expected Answer: …"); empty when the key is an uploaded file. */
  typedAnswerKey: string;
  /** Answer sheet row whose uploaded file must be OCR-ed (or read from its saved OCR cache). */
  answerKeyFileAnswerId: string | null;
  queuedAt: number;
  // Filled by stage 1 (OCR):
  studentText?: string;
  answerKeyText?: string;
  /** AI diagram/handwriting pre-scan started alongside OCR; never rejects. */
  visualPreEval?: Promise<void>;
}

// ─── Stage queue ────────────────────────────────────────────────────────────────

/** A FIFO queue that runs at most `concurrency` jobs of one stage at a time. */
class StageQueue {
  private waiting: EvaluationJob[] = [];
  private running = new Map<string, EvaluationJob>();

  constructor(
    readonly name: string,
    private readonly concurrency: number,
    private readonly work: (job: EvaluationJob) => Promise<void>
  ) {}

  push(job: EvaluationJob) {
    this.waiting.push(job);
    this.pump();
  }

  has(sheetId: string) {
    return this.running.has(sheetId) || this.waiting.some((j) => j.sheetId === sheetId);
  }

  isRunning(sheetId: string) {
    return this.running.has(sheetId);
  }

  /** 1-based place in the waiting line, or 0 when not waiting. */
  position(sheetId: string) {
    return this.waiting.findIndex((j) => j.sheetId === sheetId) + 1;
  }

  counts() {
    return { running: this.running.size, waiting: this.waiting.length };
  }

  // Start as many waiting jobs as the concurrency limit allows; each finished job
  // frees its slot and pulls in the next one.
  private pump() {
    while (this.running.size < this.concurrency && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.running.set(job.sheetId, job);
      this.work(job)
        .catch((err) => logger.error(`[Pipeline6 Queue] ${this.name} stage crashed for sheet ${job.sheetId}:`, err))
        .finally(() => {
          this.running.delete(job.sheetId);
          this.pump();
        });
    }
  }
}

/** Marks the sheet's evaluation as failed with a readable reason. */
async function failJob(sheetId: string, stage: string, err: any) {
  const message = err?.response?.data?.detail || err?.message || "Unknown error";
  logger.error(`[Pipeline6] ${stage} failed for sheet ${sheetId}: ${message}`);
  await AIEvaluation.update(
    { status: "Failed", error: `${stage} failed: ${message}` },
    { where: { sheetId } }
  ).catch(() => undefined);
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

async function readStudentSheet(job: EvaluationJob, sheet: any): Promise<string> {
  let studentText = String(sheet.ocrText || sheet.answerText || "");
  if (!studentText && sheet.fileBuffer?.length) {
    let fileName = sheet.fileName || "sheet.png";
    if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
      fileName += sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
    }
    logger.info(`[Pipeline6] [OCR] Reading student sheet ${job.sheetId} (${fileName}, ${sheet.fileBuffer.length} bytes)`);
    studentText = await ocrDocument(sheet.fileBuffer, fileName, sheet.fileMimeType || "image/png");
  }
  return studentText;
}

/** AI pre-scan of diagrams/handwriting from the student's file. Only logs on failure —
 *  /evaluate-text then evaluates the diagrams itself. */
async function runVisualPreEval(job: EvaluationJob, sheet: any, answerKeyText: string): Promise<void> {
  if (!sheet.fileBuffer?.length) return;
  const started = Date.now();
  try {
    logger.info(`[Pipeline6] [AI pre-scan] Scanning diagrams of sheet ${job.sheetId} while OCR runs`);
    await axios.post(
      pythonServices.pipeline6VisualPreEvalUrl(),
      {
        student_id: job.studentId,
        exam_id: job.examId,
        question_paper_text: job.questionText,
        answer_key_text: answerKeyText,
        student_pdf_base64: sheet.fileBuffer.toString("base64"),
        max_marks: job.maxMarks,
      },
      {
        headers: { "Content-Type": "application/json" },
        // Can wait behind another sheet's evaluation on the same AI server.
        timeout: EVAL_TIMEOUT_MS,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    logger.info(`[Pipeline6] [AI pre-scan] Sheet ${job.sheetId} pre-scanned in ${Math.round((Date.now() - started) / 1000)}s`);
  } catch (err: any) {
    logger.warn(`[Pipeline6] [AI pre-scan] Sheet ${job.sheetId} skipped (evaluation will scan diagrams itself): ${err?.message || err}`);
  }
}

async function runOcrStage(job: EvaluationJob) {
  try {
    const sheet: any = await Scanner.findOne({ where: { sheetId: job.sheetId, isDeleted: false } });
    if (!sheet) throw new Error("Scanner sheet not found.");

    // Model answer first (the pre-scan needs it): typed answers as-is; an uploaded
    // file comes from its saved OCR text (OCR-ed only the first time, then cached).
    let answerKeyText = job.typedAnswerKey;
    if (!answerKeyText && job.answerKeyFileAnswerId) {
      answerKeyText = (await getAnswerKeyText(job.answerKeyFileAnswerId)) ?? "";
    }
    job.answerKeyText = answerKeyText;

    // ⚡ In parallel: AI pre-scan (8006) runs while OCR (8000) reads the text.
    job.visualPreEval = runVisualPreEval(job, sheet, answerKeyText);
    const studentText = await readStudentSheet(job, sheet);

    // Empty/weak OCR is NOT a failure: stage 2 sends the original file too, and
    // pipeline6.py reads the whole sheet from its page images in that case.
    logger.info(`[Pipeline6] [OCR] Sheet ${job.sheetId}: ${studentText.length} chars of student text.`);

    job.studentText = studentText;
    evaluationQueue.push(job); // hand over to the AI stage; OCR moves on to the next sheet
  } catch (err: any) {
    await failJob(job.sheetId, "OCR", err);
  }
}

// ─── Stage 2: AI evaluation (port 8006) ─────────────────────────────────────────

async function runEvaluationStage(job: EvaluationJob) {
  try {
    const sheet: any = await Scanner.findOne({ where: { sheetId: job.sheetId, isDeleted: false } });
    const aiEval: any = await AIEvaluation.findOne({ where: { sheetId: job.sheetId } });
    if (!sheet || !aiEval) throw new Error("Sheet or evaluation record no longer exists.");

    // Let this sheet's diagram pre-scan finish, so /evaluate-text reuses its cached
    // results instead of scanning the diagrams a second time.
    if (job.visualPreEval) await job.visualPreEval;

    const payload = {
      student_id: job.studentId,
      exam_id: job.examId,
      question_paper_text: job.questionText,
      answer_key_text: job.answerKeyText || "",
      student_answer_text: job.studentText || "",
      max_marks: job.maxMarks,
      // Original sheet: pipeline6.py uses its page images for diagram questions and
      // for the whole-sheet fallback when OCR confidence is low / mapping fails.
      student_pdf_base64: sheet.fileBuffer?.length ? sheet.fileBuffer.toString("base64") : undefined,
    };

    logger.info(`[Pipeline6] [AI] Evaluating sheet ${job.sheetId} on ${pythonServices.pipeline6Url()}`);
    const evalResponse = await axios.post(pythonServices.pipeline6Url(), payload, {
      headers: { "Content-Type": "application/json" },
      timeout: EVAL_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    const evalResult = evalResponse.data;

    // Map the pipeline response to the AIEvaluation DB schema.
    const rawQuestions = evalResult.questions || evalResult.evaluations || [];
    const mappedQuestions = rawQuestions.map((q: any) => ({
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
        feedback: typeof q.feedback === "string" ? q.feedback : (q.feedback?.overall || "Evaluated"),
        strengths: q.strengths || [],
        improvements: q.missingConcepts || q.missing_concepts || [],
        keywords: {
          matched: q.keywordsMatched || q.keywords?.matched || [],
          missing: q.keywordsMissing || q.keywords?.missing || [],
        },
      },
    }));

    const totalObtainedScore = evalResult.summary ? evalResult.summary.obtainedMarks : (evalResult.total_score || 0);

    await aiEval.update({
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
    await sheet.update({ status: "Evaluated" });

    const waitedSeconds = Math.round((Date.now() - job.queuedAt) / 1000);
    logger.info(`[Pipeline6] [AI] Sheet ${job.sheetId} evaluated: ${totalObtainedScore} marks (${waitedSeconds}s since queued).`);
  } catch (err: any) {
    await failJob(job.sheetId, "AI evaluation", err);
  }
}

// One OCR worker and one AI worker by default — raise only if the servers have headroom.
const ocrQueue = new StageQueue("OCR", positiveInt(process.env.EVAL_QUEUE_OCR_CONCURRENCY, 1), runOcrStage);
const evaluationQueue = new StageQueue("AI evaluation", positiveInt(process.env.EVAL_QUEUE_EVAL_CONCURRENCY, 1), runEvaluationStage);

// ─── Queue status (shown on the queue page) ─────────────────────────────────────

export type QueueStage = "waiting_for_ocr" | "ocr" | "waiting_for_evaluation" | "evaluating";

export interface SheetQueueInfo {
  stage: QueueStage;
  /** 1-based place in the waiting line of that stage (0 while running). */
  position: number;
}

/** Where a sheet currently is in the queue, or null when it is not queued. */
export function getSheetQueueInfo(sheetId: string): SheetQueueInfo | null {
  if (ocrQueue.isRunning(sheetId)) return { stage: "ocr", position: 0 };
  if (evaluationQueue.isRunning(sheetId)) return { stage: "evaluating", position: 0 };
  const ocrPos = ocrQueue.position(sheetId);
  if (ocrPos) return { stage: "waiting_for_ocr", position: ocrPos };
  const evalPos = evaluationQueue.position(sheetId);
  if (evalPos) return { stage: "waiting_for_evaluation", position: evalPos };
  return null;
}

export function getQueueSnapshot() {
  return { ocr: ocrQueue.counts(), evaluation: evaluationQueue.counts() };
}

const isQueued = (sheetId: string) => ocrQueue.has(sheetId) || evaluationQueue.has(sheetId);

// ─── Trigger (enqueue) ──────────────────────────────────────────────────────────

export const triggerPipeline6Evaluation = async (
  sheetId: string,
  force: boolean = false
): Promise<any> => {
  try {
    const sheet: any = (await Scanner.findOne({ where: { sheetId, isDeleted: false } })) || (await Scanner.findByPk(sheetId));
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Scanner sheet not found." };
    }
    sheetId = sheet.sheetId;

    let aiEval: any = await AIEvaluation.findOne({ where: { sheetId } });

    // Already in line: never queue the same sheet twice.
    if (isQueued(sheetId)) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "This sheet is already queued for evaluation.",
        data: aiEval ? { ...aiEval.get({ plain: true }), queue: getSheetQueueInfo(sheetId) } : null,
      };
    }

    if (aiEval && aiEval.status === "Success" && !force) {
      return { error: false, statusCode: httpStatus.OK, message: "Sheet already evaluated.", data: aiEval };
    }

    // ── Resolve student, exam, question paper and model answer ──
    const student = await StudentProfile.findOne({
      where: { rollNumber: sheet.rollNo, instituteId: sheet.instituteId, classId: sheet.classId },
    });
    const studentId = student ? student.userId : (sheet.studentId || `STUDENT-${sheet.rollNo}`);

    let examId = sheet.examType || "EXAM-1";
    let maxMarks = 10;
    let questionText = "Evaluate student answer sheet.";
    let typedAnswerKey = "";
    let answerKeyFileAnswerId: string | null = null;

    const exam = await Exam.findOne({
      where: { instituteId: sheet.instituteId, classId: sheet.classId, subjectId: sheet.subjectId, examType: sheet.examType, isDeleted: false },
      order: [["createdAt", "DESC"]],
    });

    if (exam) {
      examId = exam.examId;
      maxMarks = exam.totalMarks || 10;
      const targetPaperSet = sheet.section || "A";

      const questionPaper = await QuestionPaper.findOne({
        where: { examId: exam.examId, instituteId: sheet.instituteId, paperSet: targetPaperSet },
        order: [["createdAt", "DESC"]],
      }) || await QuestionPaper.findOne({
        // Set not found: prefer an approved set of the exam over a draft one.
        where: { examId: exam.examId, instituteId: sheet.instituteId, status: { [Op.in]: ["APPROVED", "PUBLISHED"] } },
        order: [["paperSet", "ASC"]],
      }) || await QuestionPaper.findOne({
        where: { examId: exam.examId, instituteId: sheet.instituteId },
        order: [["createdAt", "DESC"]],
      });

      if (questionPaper) {
        const qpAnswer = await QuestionPaperAnswer.findOne({
          where: { paperId: questionPaper.paperId, paperSet: questionPaper.paperSet },
        }) || await QuestionPaperAnswer.findOne({
          where: { paperId: questionPaper.paperId },
        }) || await QuestionPaperAnswer.findOne({
          // Answer sheet kept from an earlier (deleted) paper of the same set.
          where: { examId: questionPaper.examId, paperSet: questionPaper.paperSet },
          order: [["updatedAt", "DESC"]],
        });

        const { questions, answers, calculatedTotalMarks, answerKeyFileUrl } =
          formatQuestionPaper(questionPaper.content, qpAnswer ? qpAnswer.answers : null);
        if (questions) questionText = questions;
        if (answers) typedAnswerKey = answers;
        else if (answerKeyFileUrl && qpAnswer) answerKeyFileAnswerId = qpAnswer.answerId; // uploaded model answer
        if (calculatedTotalMarks > 0) maxMarks = calculatedTotalMarks;
      }
    }

    // ── Evaluation record → Pending (the queue page polls this) ──
    if (!aiEval) {
      aiEval = await AIEvaluation.create({
        evaluationId: await RegHelper.generateUserId(),
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
      } as any);
    } else {
      await aiEval.update({ status: "Pending", error: null });
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
    logger.info(`[Pipeline6] Sheet ${sheetId} queued (${queue?.stage}, #${queue?.position}).`);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: queue?.stage === "waiting_for_ocr"
        ? `Queued for AI evaluation (position ${queue.position}).`
        : "AI evaluation started.",
      data: { ...aiEval.get({ plain: true }), queue },
    };
  } catch (error: any) {
    logger.error("[Pipeline6 Service] Initialization failed:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to initialize Pipeline 6.3 evaluation: ${error.message}`,
    };
  }
};

// ─── Restart recovery ───────────────────────────────────────────────────────────

/**
 * The queue lives in memory, so a restart drops it. Evaluations left "Pending"
 * (queued or mid-way) in the last 24 hours are put back in line on startup.
 * Disable with EVAL_QUEUE_RECOVER_ON_START=false.
 */
export async function recoverPipeline6Queue(): Promise<void> {
  if (String(process.env.EVAL_QUEUE_RECOVER_ON_START ?? "true").toLowerCase() === "false") return;
  try {
    const stuck = await AIEvaluation.findAll({
      where: { status: "Pending", updatedAt: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      order: [["updatedAt", "ASC"]],
    });
    for (const row of stuck) {
      await triggerPipeline6Evaluation(row.sheetId, true);
    }
    if (stuck.length) logger.info(`[Pipeline6 Queue] Re-queued ${stuck.length} evaluation(s) left pending before restart.`);
  } catch (err: any) {
    logger.warn(`[Pipeline6 Queue] Could not recover pending evaluations: ${err?.message || err}`);
  }
}

export default {
  triggerPipeline6Evaluation,
  getSheetQueueInfo,
  getQueueSnapshot,
  recoverPipeline6Queue,
};
