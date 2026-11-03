// ─── Pipeline 6 — main AI evaluation ────────────────────────────────────────────
//
// Every evaluation request goes through TWO durable job queues (BullMQ on PostgreSQL,
// see src/queue):
//
//   trigger ──► [ evaluation-ocr: OCR :8000 ] ──► [ evaluation-ai: AI evaluation :8006 ] ──► saved
//
// • Durable: queued and running sheets survive a restart or a crash; a sheet whose worker
//   died is picked up again once its lock lapses. Nothing waits in memory.
// • Concurrency: each stage runs at most N sheets at a time across ALL processes
//   (EVAL_QUEUE_OCR_CONCURRENCY / EVAL_QUEUE_EVAL_CONCURRENCY, default 1 — one GPU each), so
//   "Evaluate All" on 100 sheets never floods the Python servers. Across sheets the stages
//   overlap: while the AI evaluates student 1, OCR is already reading student 2.
// • Retries: a failed attempt is retried with exponential backoff (OCR 4×, AI 5×). A busy AI
//   server (503 + Retry-After) pauses the stage without using up an attempt. Errors retrying
//   can't fix (a deleted sheet, a refused request) fail at once. Failures are recorded as
//   transient or permanent; the maintenance schedule re-queues transient ones once the
//   services are back (evaluationMaintenance.ts).
// • A sheet is never queued twice; asking again returns its current place in line.
// • The paper goes to the evaluator as a structured tree (utils/evaluationPaper.ts), so
//   sub-parts, comprehension passages, OR, "attempt any N" and objective keys are marked
//   part by part, alongside the plain text older evaluators read.
// • Uploaded (PDF) model answers are OCR-ed ONCE and saved (answerKeyOcr.service), on the
//   same OCR queue, then reused for every student.
// • The student's original file is sent along with the OCR text, so when the OCR is weak or
//   answer mapping fails, pipeline6.py falls back to reading the page images itself.

import httpStatus from "http-status";
import { Op } from "sequelize";
import axios from "axios";
import Scanner from "../../models/Scanner.model";
import Exam from "../../models/Exam.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import QuestionPaperAnswer from "../../models/question-paper/StandardAnswer.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import { CrossCheckItem } from "../../models/CrossCheck.model";
import { studentForSheet } from "../student/enrollment.service";
import logger from "../../config/logger";
import { pythonServices, serviceHeaders } from "../../config/pythonServices";
import { formatQuestionPaper, paperSetOf } from "../../utils/questionPaperText";
import { buildEvaluationPaper } from "../../utils/evaluationPaper";
import { getAnswerKeyText, ocrDocument } from "./answerKeyOcr.service";
import { resolveSheetBuffer } from "../../utils/answerSheetStorage";
import { newId } from "../../utils/idGenerator";
import { failRecheckAiRun, finishRecheckAiRun, startRecheckAiRun, type RecheckContext } from "./recheckDraft.service";
import { failCrossCheckAiRun, finishCrossCheckAiRun, startCrossCheckAiRun, type CrossCheckContext } from "./crossCheckDraft.service";
import { restoreFullAnswers } from "../../utils/answerSnippets";
import { defineQueue, isPermanent, PermanentJobError, type JobContext, type JobView } from "../../queue";
import { positiveInt } from "../../queue/config";
import { failPartner, runPartnerEvaluation, runPartnerOcr } from "../partner/partnerProcessing";

const EVAL_TIMEOUT_MS = 3600000; // 1 hour — CPU inference on long papers is slow
const DAY_SEC = 24 * 60 * 60;

// ─── Job ────────────────────────────────────────────────────────────────────────

/** One evaluation run of one sheet. Only ids travel; the paper is read when the AI stage runs. */
export interface EvaluationRun {
  /** "sheet-<sheetId>", "recheck-<requestId>" or "cross-<itemId>": one live run per key. */
  runKey: string;
  /** Unique per run; the jobs of both stages are named after it. */
  runId: string;
  sheetId: string;
  studentId: string;
  examId: string;
  maxMarks: number;
  paperId: string | null;
  /** Typed answer sheet (or the uploaded one) of the paper. */
  answerId: string | null;
  /** Set when the model answer is an uploaded file: its OCR text is the key. */
  answerKeyFileAnswerId: string | null;
  queuedAt: number;
  requestedBy: string | null;
  /** A recheck re-run (published results): the outcome goes into that recheck's draft. */
  recheckRequestId?: string;
  /** A cross-checker's re-run: the outcome goes into their cross-check item's draft. */
  crossCheckItemId?: string;
  // Filled by the OCR stage. A normal run keeps the text on its evaluation row (studentAnsOcr)
  // so queue listings stay small; a recheck / cross-check run must not touch that row and
  // carries it here.
  studentText?: string;
  ocrMs?: number;
}

interface AnswerKeyWarmup {
  answerId: string;
}

/** A partner API evaluation (services/partner): same stages, same limits. */
interface PartnerJob {
  partnerEvaluationId: string;
}

type OcrJobData = EvaluationRun | AnswerKeyWarmup | PartnerJob;
type AiJobData = EvaluationRun | PartnerJob;

const isRun = (data: OcrJobData): data is EvaluationRun => "runKey" in data;
const isPartner = (data: OcrJobData): data is PartnerJob => "partnerEvaluationId" in data;
const isServiceCallError = (err: any) => Boolean(err?.response || err?.code || err?.isAxiosError);

// ─── Errors ─────────────────────────────────────────────────────────────────────

const serviceError = (service: "OCR" | "AI", err: any): string =>
  err?.response?.data?.detail || err?.response?.data?.message || err?.message || `Unknown ${service} error`;

/** Retry-After (seconds or a date) → milliseconds, 30 s when absent. */
const retryAfterMs = (value: unknown): number => {
  const raw = String(value ?? "").trim();
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(1000, at - Date.now()) : 30_000;
};

/**
 * A Python service call failed: back off when it is busy, give up when it refused the request
 * (retrying would get the same answer), otherwise throw so the attempt is retried.
 */
async function handleServiceError(job: JobContext<any>, service: "OCR" | "AI", err: any): Promise<never> {
  const status: number | undefined = err?.response?.status;
  const detail = serviceError(service, err);
  if (status === 503 || status === 429) {
    logger.info(`[Pipeline6] ${service} server busy; the ${service} stage pauses ${Math.round(retryAfterMs(err.response.headers?.["retry-after"]) / 1000)}s.`);
    return job.rateLimit(retryAfterMs(err.response.headers?.["retry-after"]));
  }
  if (status === 401 || status === 403) {
    throw new PermanentJobError(
      `The ${service} step was refused (${status}): ${detail}. If the ${service} server runs with INTERNAL_API_TOKEN, ` +
        `set ${service === "OCR" ? "OCR_SERVICE_TOKEN" : "EVAL_SERVICE_TOKEN"} to the same value.`
    );
  }
  if (status && status >= 400 && status < 500 && status !== 408) {
    throw new PermanentJobError(`The ${service} step could not process this sheet (${status}): ${detail}`);
  }
  throw new Error(status ? `${service} server error ${status}: ${detail}` : `${service} server unreachable: ${detail}`);
}

/** Marks the run as failed for good with a readable reason. */
async function failRun(run: EvaluationRun, stage: string, err: any) {
  const message = serviceError(stage === "OCR" ? "OCR" : "AI", err);
  logger.error(`[Pipeline6] ${stage} failed for sheet ${run.sheetId}: ${message}`);
  // A recheck re-run fails in its draft; the published evaluation stays as it was.
  if (run.recheckRequestId) {
    await failRecheckAiRun(run.recheckRequestId, `${stage} failed: ${message}`);
    return;
  }
  // So does a cross-checker's; the evaluator's marks stay as they were.
  if (run.crossCheckItemId) {
    await failCrossCheckAiRun(run.crossCheckItemId, `${stage} failed: ${message}`);
    return;
  }
  await AIEvaluation.update(
    {
      status: "Failed",
      error: `${stage} failed: ${message}`,
      failureKind: isPermanent(err) ? "permanent" : "transient",
      finishedAt: new Date(),
    } as any,
    { where: { sheetId: run.sheetId, status: "Pending" } }
  ).catch(() => undefined);
}

/** Is this run still wanted? (The sheet may have been replaced, or the draft closed, while it waited.) */
async function runWanted(run: EvaluationRun): Promise<boolean> {
  if (run.recheckRequestId) {
    const a = await RecheckAssignment.findOne({ where: { requestId: run.recheckRequestId }, attributes: ["draft"] });
    return a?.draft?.status === "Pending";
  }
  if (run.crossCheckItemId) {
    const item = await CrossCheckItem.findOne({ where: { itemId: run.crossCheckItemId }, attributes: ["draft"] });
    return item?.draft?.status === "Pending";
  }
  return (await AIEvaluation.count({ where: { sheetId: run.sheetId } })) > 0;
}

// ─── Stage 1: OCR (port 8000) ───────────────────────────────────────────────────

async function readStudentSheet(run: EvaluationRun, sheet: any): Promise<string> {
  let studentText = String(sheet.ocrText || sheet.answerText || "");
  if (!studentText && sheet.fileBuffer?.length) {
    let fileName = sheet.fileName || "sheet.png";
    if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
      fileName += sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
    }
    logger.info(`[Pipeline6] [OCR] Reading student sheet ${run.sheetId} (${fileName}, ${sheet.fileBuffer.length} bytes)`);
    studentText = await ocrDocument(sheet.fileBuffer, fileName, sheet.fileMimeType || "image/png");
  }
  return studentText;
}

async function runOcrStage(job: JobContext<EvaluationRun>) {
  const run = job.data;
  if (!(await runWanted(run))) {
    logger.info(`[Pipeline6] [OCR] Sheet ${run.sheetId}: run ${run.runId} no longer wanted, skipped.`);
    return { skipped: true };
  }
  const started = Date.now();
  if (!run.recheckRequestId && !run.crossCheckItemId && job.attemptsMade === 0) {
    await AIEvaluation.update({ startedAt: new Date() } as any, { where: { sheetId: run.sheetId } }).catch(() => undefined);
  }

  const sheet: any = await Scanner.findOne({ where: { sheetId: run.sheetId, isDeleted: false } });
  if (!sheet) throw new PermanentJobError("The answer sheet was deleted.");
  // Cloudinary-backed sheets keep fileBuffer null in the database; fetch the real bytes.
  sheet.fileBuffer = await resolveSheetBuffer(sheet);

  let studentText = "";
  try {
    // An uploaded model answer is read here too (once; its text is saved for every later student),
    // so all OCR goes through this one queue.
    if (run.answerKeyFileAnswerId) await getAnswerKeyText(run.answerKeyFileAnswerId);
    studentText = await readStudentSheet(run, sheet);
  } catch (err: any) {
    if (isServiceCallError(err)) return handleServiceError(job, "OCR", err);
    throw err;
  }

  // Empty/weak OCR is NOT a failure: the AI stage sends the original file too, and
  // pipeline6.py reads the whole sheet from its page images in that case.
  logger.info(`[Pipeline6] [OCR] Sheet ${run.sheetId}: ${studentText.length} chars of student text in ${Math.round((Date.now() - started) / 1000)}s.`);

  const ownRow = !run.recheckRequestId && !run.crossCheckItemId;
  if (ownRow) await AIEvaluation.update({ studentAnsOcr: studentText } as any, { where: { sheetId: run.sheetId } });

  // Hand over to the AI stage (while this job still holds the run, so it is never "not queued").
  await aiQueue.add(
    "evaluate",
    { ...run, ...(ownRow ? {} : { studentText }), ocrMs: Date.now() - started },
    { jobId: `ai-${run.runId}`, dedupeKey: run.runKey }
  );
  return { chars: studentText.length };
}

/** OCR of a freshly uploaded model answer, so the first student evaluation doesn't wait for it. */
async function runAnswerKeyWarmup(job: JobContext<AnswerKeyWarmup>) {
  try {
    const text = await getAnswerKeyText(job.data.answerId);
    return { chars: text?.length ?? 0 };
  } catch (err: any) {
    if (isServiceCallError(err)) return handleServiceError(job, "OCR", err);
    throw err;
  }
}

// ─── Stage 2: AI evaluation (port 8006) ─────────────────────────────────────────

/** The paper and its key as the evaluator reads them, from the rows named in the run. */
async function paperMaterial(run: EvaluationRun) {
  const paper = run.paperId ? await QuestionPaper.findOne({ where: { paperId: run.paperId } }) : null;
  const answers = run.answerId ? await QuestionPaperAnswer.findOne({ where: { answerId: run.answerId } }) : null;
  if (!paper) {
    return { questionText: "Evaluate student answer sheet.", typedKey: "", structured: null as ReturnType<typeof buildEvaluationPaper> | null, maxMarks: run.maxMarks };
  }
  const flat = formatQuestionPaper(paper.content, answers ? answers.answers : null);
  const structured = buildEvaluationPaper(paper.content, answers ? answers.answers : null);
  return {
    questionText: flat.questions || "Evaluate student answer sheet.",
    typedKey: flat.answers,
    structured: structured.paper ? structured : null,
    maxMarks: flat.calculatedTotalMarks > 0 ? flat.calculatedTotalMarks : run.maxMarks,
  };
}

/** Pipeline response → the AIEvaluation `evaluations` items (sub-part structure included). */
function mapQuestions(evalResult: any) {
  const rawQuestions = evalResult.questions || evalResult.evaluations || [];
  return rawQuestions.map((q: any) => ({
    questionId: q.questionId || q.question_id || "",
    questionText: q.questionText || q.question_text || q.question || "",
    studentAnswer: q.studentAnswer || q.student_answer_snippet || "",
    expectedAnswer: q.expectedAnswer || "",
    marks: q.marks || {
      obtained: q.obtainedMarks !== undefined ? q.obtainedMarks : (q.score || 0),
      maximum: q.maxMarks !== undefined ? q.maxMarks : (q.max_marks || 0),
    },
    status: q.status || "Incorrect",
    // Where the part sits in the paper: Q.5 → (b) → (ii), its OR side, "attempt any N".
    ...(q.parentId !== undefined ? { parentId: q.parentId ?? null } : {}),
    ...(q.rootId ? { rootId: q.rootId } : {}),
    ...(q.label ? { label: q.label } : {}),
    ...(Array.isArray(q.path) ? { path: q.path } : {}),
    ...(q.questionType ? { questionType: q.questionType } : {}),
    ...(q.sourceId ? { sourceId: q.sourceId } : {}),
    ...(q.choice ? { choice: q.choice } : {}),
    ...(q.counted !== undefined ? { counted: q.counted !== false } : {}),
    ...(q.notCountedReason ? { notCountedReason: q.notCountedReason } : {}),
    ...(q.method ? { method: q.method } : {}),
    ...(q.needsReview !== undefined ? { needsReview: Boolean(q.needsReview) } : {}),
    ...(Array.isArray(q.reviewReasons) && q.reviewReasons.length ? { reviewReasons: q.reviewReasons } : {}),
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
}

async function runEvaluationStage(job: JobContext<EvaluationRun>) {
  const run = job.data;
  if (!(await runWanted(run))) {
    logger.info(`[Pipeline6] [AI] Sheet ${run.sheetId}: run ${run.runId} no longer wanted, skipped.`);
    return { skipped: true };
  }
  const sheet: any = await Scanner.findOne({ where: { sheetId: run.sheetId, isDeleted: false } });
  if (!sheet) throw new PermanentJobError("The answer sheet was deleted.");
  const aiEval: any = await AIEvaluation.findOne({ where: { sheetId: run.sheetId } });
  if (!aiEval && !run.recheckRequestId && !run.crossCheckItemId) return { skipped: true };

  // Cloudinary-backed sheets keep fileBuffer null; the AI uses the page images.
  sheet.fileBuffer = await resolveSheetBuffer(sheet);
  const material = await paperMaterial(run);
  const studentText = run.studentText ?? String(aiEval?.studentAnsOcr ?? "");

  // The key: the uploaded sheet's OCR text (saved by the OCR stage), else the typed answers.
  // With the structured paper the typed keys travel inside it, so only answers it couldn't
  // place go as text.
  const uploadedKey = run.answerKeyFileAnswerId ? (await getAnswerKeyText(run.answerKeyFileAnswerId).catch(() => null)) ?? "" : "";
  const answerKeyText = uploadedKey || (material.structured ? material.structured.keyText : material.typedKey);

  const payload = {
    student_id: run.studentId,
    exam_id: run.examId,
    question_paper_text: material.questionText,
    answer_key_text: answerKeyText || "",
    student_answer_text: studentText,
    max_marks: material.maxMarks,
    ...(material.structured ? { paper: material.structured.paper } : {}),
    request_id: job.id,
    // Original sheet: page images for diagram questions and the whole-sheet fallback.
    student_pdf_base64: sheet.fileBuffer?.length ? sheet.fileBuffer.toString("base64") : undefined,
  };

  const started = Date.now();
  logger.info(
    `[Pipeline6] [AI] Evaluating sheet ${run.sheetId} on ${pythonServices.pipeline6Url()}` +
      (material.structured ? ` (structured paper: ${material.structured.leaves} parts, ${material.structured.keyed} with a typed key)` : "") +
      (job.attemptsMade ? ` — attempt ${job.attemptsMade + 1}/${job.maxAttempts}` : "")
  );
  let evalResult: any;
  try {
    const evalResponse = await axios.post(pythonServices.pipeline6Url(), payload, {
      headers: { "Content-Type": "application/json", ...serviceHeaders("eval") },
      timeout: EVAL_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    evalResult = evalResponse.data;
  } catch (err: any) {
    return handleServiceError(job, "AI", err);
  }

  const pipelineQuestions = mapQuestions(evalResult);
  // The pipeline cuts each answer at 300 characters; keep them whole, from the texts it was given.
  const mappedQuestions = restoreFullAnswers(pipelineQuestions, { student: studentText, answerKey: answerKeyText });

  const totalObtainedScore = evalResult.summary ? evalResult.summary.obtainedMarks : (evalResult.total_score || 0);
  const overall = typeof evalResult.feedback === "object"
    ? (evalResult.feedback.overall || JSON.stringify(evalResult.feedback))
    : (evalResult.feedback || "");
  const tree = Array.isArray(evalResult.tree) && evalResult.tree.length ? evalResult.tree : null;

  if (run.recheckRequestId) {
    await finishRecheckAiRun(run.recheckRequestId, { evaluations: mappedQuestions, totalScore: Number(totalObtainedScore), feedback: overall });
    logger.info(`[Pipeline6] [AI] Recheck ${run.recheckRequestId}: sheet ${run.sheetId} re-evaluated (${totalObtainedScore} marks, draft).`);
    return { score: totalObtainedScore };
  }
  if (run.crossCheckItemId) {
    await finishCrossCheckAiRun(run.crossCheckItemId, { evaluations: mappedQuestions, totalScore: Number(totalObtainedScore), feedback: overall });
    logger.info(`[Pipeline6] [AI] Cross-check ${run.crossCheckItemId}: sheet ${run.sheetId} re-evaluated (${totalObtainedScore} marks, draft).`);
    return { score: totalObtainedScore };
  }

  await aiEval.update({
    status: "Success",
    totalScore: totalObtainedScore,
    feedback: overall,
    evaluations: mappedQuestions,
    resultTree: tree,
    studentAnsOcr: studentText,
    standardAnsOcr: answerKeyText || "",
    questionOcr: material.questionText,
    error: null,
    failureKind: null,
    finishedAt: new Date(),
  });
  await sheet.update({ status: "Evaluated" });

  const waitedSeconds = Math.round((Date.now() - run.queuedAt) / 1000);
  logger.info(`[Pipeline6] [AI] Sheet ${run.sheetId} evaluated: ${totalObtainedScore} marks in ${Math.round((Date.now() - started) / 1000)}s (${waitedSeconds}s since queued).`);
  return { score: totalObtainedScore };
}

// ─── Queues ─────────────────────────────────────────────────────────────────────

// One OCR and one AI evaluation at a time across all processes by default (one GPU each) —
// raise only if the servers have headroom. Retries wait 30 s / 60 s, doubling each time.
const ocrConcurrency = positiveInt(process.env.EVAL_QUEUE_OCR_CONCURRENCY, 1);
const evalConcurrency = positiveInt(process.env.EVAL_QUEUE_EVAL_CONCURRENCY, 1);
const ocrRetryMs = positiveInt(process.env.EVAL_QUEUE_OCR_RETRY_MS, 30_000);
const evalRetryMs = positiveInt(process.env.EVAL_QUEUE_EVAL_RETRY_MS, 60_000);

async function runPartnerOcrStage(job: JobContext<PartnerJob>) {
  const id = job.data.partnerEvaluationId;
  let outcome: { skipped?: boolean; chars?: number };
  try {
    outcome = await runPartnerOcr(id);
  } catch (err: any) {
    if (isServiceCallError(err)) return handleServiceError(job, "OCR", err);
    throw err;
  }
  if (outcome.skipped) return outcome;
  await aiQueue.add("partner", { partnerEvaluationId: id }, { jobId: `pai-${id}`, dedupeKey: `partner-${id}` });
  return outcome;
}

async function runPartnerAiStage(job: JobContext<PartnerJob>) {
  try {
    return await runPartnerEvaluation(job.data.partnerEvaluationId);
  } catch (err: any) {
    if (isServiceCallError(err)) return handleServiceError(job, "AI", err);
    throw err;
  }
}

const ocrQueue = defineQueue<OcrJobData>({
  name: "evaluation-ocr",
  concurrency: ocrConcurrency,
  globalConcurrency: ocrConcurrency,
  defaults: { attempts: 4, backoff: { type: "exponential", delayMs: ocrRetryMs }, keepCompletedSec: DAY_SEC, keepFailedSec: 7 * DAY_SEC },
  lockMs: 120_000,
  maxStalls: 2,
  processor: (job) =>
    isRun(job.data)
      ? runOcrStage(job as JobContext<EvaluationRun>)
      : isPartner(job.data)
        ? runPartnerOcrStage(job as JobContext<PartnerJob>)
        : runAnswerKeyWarmup(job as JobContext<AnswerKeyWarmup>),
  onFailed: async (job: JobView<OcrJobData>, err) => {
    if (isRun(job.data)) await failRun(job.data, "OCR", err);
    else if (isPartner(job.data)) await failPartner(job.data.partnerEvaluationId, "OCR", err);
    else logger.warn(`[AnswerKey OCR] Background read of model answer ${job.data.answerId} failed: ${err?.message || err}`);
  },
});

const aiQueue = defineQueue<AiJobData>({
  name: "evaluation-ai",
  concurrency: evalConcurrency,
  globalConcurrency: evalConcurrency,
  defaults: { attempts: 5, backoff: { type: "exponential", delayMs: evalRetryMs }, keepCompletedSec: DAY_SEC, keepFailedSec: 7 * DAY_SEC },
  lockMs: 120_000,
  maxStalls: 2,
  processor: (job) =>
    isPartner(job.data) ? runPartnerAiStage(job as JobContext<PartnerJob>) : runEvaluationStage(job as JobContext<EvaluationRun>),
  onFailed: (job, err) =>
    isPartner(job.data) ? failPartner(job.data.partnerEvaluationId, "AI", err) : failRun(job.data as EvaluationRun, "AI evaluation", err),
});

/** Queues a partner evaluation: its OCR first when it came as a file, else straight to the AI. */
export async function queuePartnerEvaluation(evaluationId: string, needsOcr: boolean): Promise<void> {
  const data = { partnerEvaluationId: evaluationId };
  if (needsOcr) await ocrQueue.add("partner", data, { jobId: `pocr-${evaluationId}`, dedupeKey: `partner-${evaluationId}` });
  else await aiQueue.add("partner", data, { jobId: `pai-${evaluationId}`, dedupeKey: `partner-${evaluationId}` });
}

/** Takes a partner evaluation out of the queues; false when one of its steps is already running. */
export async function unqueuePartnerEvaluation(evaluationId: string): Promise<boolean> {
  const jobs = [await ocrQueue.getJob(`pocr-${evaluationId}`), await aiQueue.getJob(`pai-${evaluationId}`)].filter(Boolean) as JobView<any>[];
  if (jobs.some((j) => j.state === "active")) return false;
  await ocrQueue.remove(`pocr-${evaluationId}`).catch(() => false);
  await aiQueue.remove(`pai-${evaluationId}`).catch(() => false);
  return true;
}

/** Waiting place of a partner evaluation, for its status. */
export async function partnerQueuePlace(evaluationId: string): Promise<{ stage: string; position: number } | null> {
  for (const [stage, q, id] of [["evaluating", aiQueue, `pai-${evaluationId}`], ["ocr", ocrQueue, `pocr-${evaluationId}`]] as const) {
    const job = await q.getJob(id);
    if (job && (job.state === "waiting" || job.state === "active" || job.state === "delayed")) {
      return { stage: job.state === "active" ? stage : stage === "ocr" ? "waiting_for_ocr" : "waiting_for_evaluation", position: job.position };
    }
  }
  return null;
}

/** Starts reading a freshly uploaded model answer in the background (deduplicated per file). */
export function warmAnswerKeyOcr(answerId: string): void {
  ocrQueue
    .add("answer-key", { answerId }, { dedupeKey: `answer-key-${answerId}`, attempts: 3 })
    .catch((err) => logger.warn(`[AnswerKey OCR] Could not queue model answer ${answerId}: ${err?.message || err}`));
}

// ─── Queue status (shown on the queue page) ─────────────────────────────────────

export type QueueStage = "waiting_for_ocr" | "ocr" | "waiting_for_evaluation" | "evaluating";

export interface SheetQueueInfo {
  stage: QueueStage;
  /** 1-based place in the waiting line of that stage (0 while running or waiting to retry). */
  position: number;
  /** This attempt's number (1 = first try). */
  attempt: number;
  /** Waiting to retry after a failed attempt. */
  retrying: boolean;
  queuedAt: number;
}

interface QueueSnapshot {
  at: number;
  bySheet: Map<string, SheetQueueInfo>;
  byRun: Map<string, SheetQueueInfo>;
  counts: { ocr: { running: number; waiting: number; retrying: number }; evaluation: { running: number; waiting: number; retrying: number } };
}

let snapshot: QueueSnapshot | null = null;
let snapshotLoading: Promise<QueueSnapshot> | null = null;
const SNAPSHOT_TTL_MS = 2000; // the queue page polls; one read of the queues serves every poll

const stageOf = (job: JobView<any>, ocr: boolean): SheetQueueInfo => ({
  stage: ocr ? (job.state === "active" ? "ocr" : "waiting_for_ocr") : job.state === "active" ? "evaluating" : "waiting_for_evaluation",
  position: job.position,
  attempt: job.attemptsMade + 1,
  retrying: job.state === "delayed" && job.attemptsMade > 0,
  queuedAt: (job.data as EvaluationRun).queuedAt ?? job.createdAt,
});

async function loadSnapshot(): Promise<QueueSnapshot> {
  const [ocrJobs, aiJobs] = await Promise.all([ocrQueue.liveJobs(5000), aiQueue.liveJobs(5000)]);
  const bySheet = new Map<string, SheetQueueInfo>();
  const byRun = new Map<string, SheetQueueInfo>();
  const count = (jobs: JobView<any>[]) => ({
    running: jobs.filter((j) => j.state === "active").length,
    waiting: jobs.filter((j) => j.state === "waiting").length,
    retrying: jobs.filter((j) => j.state === "delayed").length,
  });
  const ocrRuns = ocrJobs.filter((j) => isRun(j.data));
  for (const j of ocrRuns) {
    const info = stageOf(j, true);
    bySheet.set((j.data as EvaluationRun).sheetId, info);
    byRun.set((j.data as EvaluationRun).runKey, info);
  }
  // The AI stage wins: during the hand-over a run briefly sits in both.
  for (const j of aiJobs) {
    if (!isRun(j.data)) continue; // a partner evaluation: counted below, not a school sheet
    const info = stageOf(j, false);
    bySheet.set(j.data.sheetId, info);
    byRun.set(j.data.runKey, info);
  }
  // Counts are the stages' real load, partner evaluations included (they share the servers).
  return { at: Date.now(), bySheet, byRun, counts: { ocr: count(ocrJobs.filter((j) => isRun(j.data) || isPartner(j.data))), evaluation: count(aiJobs) } };
}

async function currentSnapshot(fresh = false): Promise<QueueSnapshot> {
  if (!fresh && snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot;
  if (!snapshotLoading) {
    snapshotLoading = loadSnapshot()
      .then((s) => (snapshot = s))
      .finally(() => {
        snapshotLoading = null;
      });
  }
  return snapshotLoading;
}

/** Where a sheet currently is in the queue, or null when it is not queued. */
export async function getSheetQueueInfo(sheetId: string): Promise<SheetQueueInfo | null> {
  try {
    return (await currentSnapshot()).bySheet.get(sheetId) ?? null;
  } catch (err: any) {
    logger.warn(`[Pipeline6 Queue] Queue status unavailable: ${err?.message || err}`);
    return null;
  }
}

/** Queue places of many sheets in one read (batch status of the queue page). */
export async function getSheetsQueueInfo(sheetIds: string[]): Promise<Map<string, SheetQueueInfo>> {
  const snap = await currentSnapshot();
  return new Map(sheetIds.filter((id) => snap.bySheet.has(id)).map((id) => [id, snap.bySheet.get(id)!]));
}

export async function getQueueSnapshot() {
  return (await currentSnapshot()).counts;
}

/** The live run with this key, from the queues themselves (not the cached snapshot). */
async function liveRun(runKey: string): Promise<boolean> {
  const [inOcr, inAi] = await Promise.all([ocrQueue.dedupedJobId(runKey), aiQueue.dedupedJobId(runKey)]);
  return Boolean(inOcr || inAi);
}

/** Run keys that have a live job — for the maintenance watchdog. */
export async function liveRunKeys(): Promise<Set<string>> {
  return new Set((await currentSnapshot(true)).byRun.keys());
}

// ─── Trigger (enqueue) ──────────────────────────────────────────────────────────

/** Exam, paper and model answer of a sheet. */
async function resolveSheetContext(sheet: any) {
  // The student with this roll number in the sheet's class and section, in its exam's session.
  const ownerId = await studentForSheet(sheet);
  const studentId = ownerId ?? (sheet.studentId || `STUDENT-${sheet.rollNo}`);

  let examId = sheet.examType || "EXAM-1";
  let maxMarks = 10;
  let paperId: string | null = null;
  let answerId: string | null = null;
  let answerKeyFileAnswerId: string | null = null;

  const exam = await Exam.findOne({
    where: sheet.examId
      ? { examId: sheet.examId, isDeleted: false }
      : { instituteId: sheet.instituteId, classId: sheet.classId, subjectId: sheet.subjectId, examType: sheet.examType, isDeleted: false },
    order: [["createdAt", "DESC"]],
  }) || await Exam.findOne({
    where: { instituteId: sheet.instituteId, classId: sheet.classId, subjectId: sheet.subjectId, examType: sheet.examType, isDeleted: false },
    order: [["createdAt", "DESC"]],
  });

  if (exam) {
    examId = exam.examId;
    maxMarks = exam.totalMarks || 10;
    // The section's letter picks the paper set (A–D; "A" for sections named otherwise).
    const targetPaperSet = paperSetOf(sheet.section);

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
      paperId = questionPaper.paperId;
      const qpAnswer = await QuestionPaperAnswer.findOne({
        where: { paperId: questionPaper.paperId, paperSet: questionPaper.paperSet },
      }) || await QuestionPaperAnswer.findOne({
        where: { paperId: questionPaper.paperId },
      }) || await QuestionPaperAnswer.findOne({
        // Answer sheet kept from an earlier (deleted) paper of the same set.
        where: { examId: questionPaper.examId, paperSet: questionPaper.paperSet },
        order: [["updatedAt", "DESC"]],
      });

      if (qpAnswer) {
        answerId = qpAnswer.answerId;
        const { answers, calculatedTotalMarks, answerKeyFileUrl } = formatQuestionPaper(questionPaper.content, qpAnswer.answers);
        if (!answers && answerKeyFileUrl) answerKeyFileAnswerId = qpAnswer.answerId; // uploaded model answer
        if (calculatedTotalMarks > 0) maxMarks = calculatedTotalMarks;
      } else {
        const { calculatedTotalMarks } = formatQuestionPaper(questionPaper.content, null);
        if (calculatedTotalMarks > 0) maxMarks = calculatedTotalMarks;
      }
    }
  }
  return { studentId, examId, maxMarks, paperId, answerId, answerKeyFileAnswerId };
}

const runIdFor = (runKey: string) => `${runKey}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const triggerPipeline6Evaluation = async (
  sheetId: string,
  force: boolean = false,
  /** A recheck teacher's re-run on a published sheet: the outcome goes into the recheck's draft. */
  recheck: RecheckContext | null = null,
  /** A cross-checker's re-run: the outcome goes into their cross-check draft. */
  crossCheck: CrossCheckContext | null = null,
  /** `withQueueInfo: false` skips reading the queue for this sheet's place (a batch reads it once). */
  options: { requestedBy?: string | null; withQueueInfo?: boolean } = {}
): Promise<any> => {
  const placeOf = async (runKey: string) =>
    options.withQueueInfo === false ? null : (await currentSnapshot(true)).byRun.get(runKey) ?? null;
  try {
    const sheet: any = (await Scanner.findOne({ where: { sheetId, isDeleted: false } })) || (await Scanner.findByPk(sheetId));
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Scanner sheet not found." };
    }
    sheetId = sheet.sheetId;
    const runKey = recheck
      ? `recheck-${recheck.request.requestId}`
      : crossCheck
        ? `cross-${crossCheck.item.itemId}`
        : `sheet-${sheetId}`;

    let aiEval: any = await AIEvaluation.findOne({ where: { sheetId } });

    // Already in line: never queue the same sheet twice.
    if (await liveRun(runKey)) {
      const queue = await placeOf(runKey);
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "This sheet is already queued for evaluation.",
        data: aiEval ? { ...aiEval.get({ plain: true }), ...(recheck || crossCheck ? { status: "Pending" } : {}), queue } : null,
      };
    }

    if (aiEval && aiEval.status === "Success" && !force && !recheck && !crossCheck) {
      return { error: false, statusCode: httpStatus.OK, message: "Sheet already evaluated.", data: aiEval };
    }

    const ctx = await resolveSheetContext(sheet);
    const now = new Date();

    // ── Evaluation record → Pending (the queue page polls this) ──
    const pending = { status: "Pending", error: null, failureKind: null, queuedAt: now, startedAt: null, finishedAt: null };
    if (!aiEval) {
      try {
        aiEval = await AIEvaluation.create({
          evaluationId: newId("evaluation"),
          sheetId,
          studentId: ctx.studentId,
          examId: ctx.examId,
          classId: sheet.classId || "",
          subjectId: sheet.subjectId || "",
          examType: sheet.examType || "",
          section: sheet.section || "",
          totalScore: 0,
          evaluations: [],
          runCount: 1,
          ...pending,
        } as any);
      } catch (err: any) {
        // Two requests for a new sheet at once: the other one created the row.
        if (err?.name !== "SequelizeUniqueConstraintError") throw err;
        aiEval = await AIEvaluation.findOne({ where: { sheetId } });
        await aiEval.update({ ...pending, runCount: (aiEval.runCount ?? 0) + 1 });
      }
    } else if (recheck) {
      // A recheck re-run: the draft waits; the published evaluation keeps its status and marks.
      await startRecheckAiRun(recheck);
    } else if (crossCheck) {
      // A cross-checker's re-run: the draft waits; the evaluator's marks stay live.
      await startCrossCheckAiRun(crossCheck);
    } else {
      await aiEval.update({ ...pending, runCount: (aiEval.runCount ?? 0) + 1 });
    }

    const run: EvaluationRun = {
      runKey,
      runId: runIdFor(runKey),
      sheetId,
      ...ctx,
      queuedAt: now.getTime(),
      requestedBy: options.requestedBy ?? null,
      ...(recheck ? { recheckRequestId: recheck.request.requestId } : {}),
      ...(crossCheck ? { crossCheckItemId: crossCheck.item.itemId } : {}),
    };
    await ocrQueue.add("sheet", run, { jobId: `ocr-${run.runId}`, dedupeKey: runKey });

    const queue = await placeOf(runKey);
    logger.info(`[Pipeline6] Sheet ${sheetId} queued${queue ? ` (${queue.stage}, #${queue.position})` : ""}.`);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: queue && queue.stage === "waiting_for_ocr" && queue.position > 0
        ? `Queued for AI evaluation (position ${queue.position}).`
        : "AI evaluation started.",
      data: { ...aiEval.get({ plain: true }), ...(recheck || crossCheck ? { status: "Pending" } : {}), queue },
    };
  } catch (error: any) {
    logger.error("[Pipeline6 Service] Initialization failed:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to queue the AI evaluation: ${error.message}`,
    };
  }
};

export default {
  triggerPipeline6Evaluation,
  getSheetQueueInfo,
  getSheetsQueueInfo,
  getQueueSnapshot,
  liveRunKeys,
  warmAnswerKeyOcr,
};
