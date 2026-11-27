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
// • Retries: a server that can't be reached (down, restarting, wrong address), a busy one (503),
//   a server error or a dropped connection is retried with exponential backoff (OCR 4×: waits of
//   30 s, 60 s, 120 s; AI 5×: 60 s … 480 s). After the last attempt the sheet is Failed and the
//   teacher decides whether to run it again: nothing re-runs a failed sheet on its own (each run
//   may be billed). A call that runs past its timeout (EVAL_OCR_TIMEOUT_MIN / EVAL_AI_TIMEOUT_MIN,
//   default 60) is not retried: the server may still be busy with it, and one sheet must not hold
//   the line for hours. Errors retrying can't fix (a deleted sheet, a refused request) fail at
//   once. Every failure is saved with a code (evaluationFailure.ts) that the queue page explains.
// • A sheet is never queued twice; asking again returns its current place in line.
// • Every step is logged (evaluationQueueMonitor.ts): logs/queue.log has one JSON line per event,
//   the console one "[EvalQueue] …" line per step, with the sheet, attempt, wait, what runs next
//   and a summary every minute while the queue has work.
// • Several API processes on one database: each live run keeps its row fresh (heartbeat), so
//   another process's watchdog never takes over a sheet that is still in line here.
// • The paper goes to the evaluator as a structured tree (utils/evaluationPaper.ts), so
//   sub-parts, comprehension passages, OR, "attempt any N" and objective keys are marked
//   part by part, alongside the plain text older evaluators read.
// • Uploaded (PDF) model answers are OCR-ed ONCE and saved (answerKeyOcr.service), on the
//   same OCR queue, then reused for every student.
// • The student's original file is sent along with the OCR text, so when the OCR is weak or
//   answer mapping fails, pipeline6.py falls back to reading the page images itself.

import httpStatus from "http-status";
import { Op, QueryTypes } from "sequelize";
import axios from "axios";
import { sequelize } from "../../config/sequelize";
import Scanner from "../../models/Scanner.model";
import Exam from "../../models/Exam.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import QuestionPaperAnswer from "../../models/question-paper/StandardAnswer.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import { CrossCheckItem } from "../../models/CrossCheck.model";
import { studentForSheet } from "../student/enrollment.service";
import logger from "../../config/logger";
import { pythonServices, serviceHeaders, serviceReachable } from "../../config/pythonServices";
import { formatQuestionPaper, paperSetOf } from "../../utils/questionPaperText";
import fs from "fs";
import path from "path";
import { buildEvaluationPaper, inlinePaperImages, placeUploadedKey } from "../../utils/evaluationPaper";
import { localPathOf } from "../../utils/localFileStorage";
import { getAnswerKeyFile, getAnswerKeyText, ocrDocument, ocrTimeoutMs } from "./answerKeyOcr.service";
import { resolveSheetBuffer } from "../../utils/answerSheetStorage";
import { newId } from "../../utils/idGenerator";
import { failRecheckAiRun, finishRecheckAiRun, startRecheckAiRun, type RecheckContext } from "./recheckDraft.service";
import { failCrossCheckAiRun, finishCrossCheckAiRun, startCrossCheckAiRun, type CrossCheckContext } from "./crossCheckDraft.service";
import { restoreFullAnswers } from "../../utils/answerSnippets";
import {
  defineQueue,
  isPermanent,
  onQueueEvent,
  PermanentJobError,
  queueDriverKind,
  queueWorkers,
  queueWorkersRunningHere,
  type JobContext,
  type JobView,
  type QueueEvent,
  type WorkerPresence,
} from "../../queue";
import { positiveInt, queueConfig } from "../../queue/config";
import { failPartner, runPartnerEvaluation, runPartnerOcr } from "../partner/partnerProcessing";
import { msg } from "../../i18n/message";
import { classifyFailureText, serviceProblem, StageFailure, type EvaluationFailure, type FailureCode } from "./evaluationFailure";
import {
  checkOtherQueueProcesses,
  fmtMs,
  instance,
  recentEvents,
  record,
  serviceDown,
  serviceOutage,
  servicesHealth,
  serviceUp,
  watchOtherQueueProcesses,
  type EvalService,
} from "./evaluationQueueMonitor";

/** CPU inference on long papers is slow: 1 hour unless EVAL_AI_TIMEOUT_MIN says otherwise. */
const aiTimeoutMs = () => positiveInt(process.env.EVAL_AI_TIMEOUT_MIN, 60) * 60_000;
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
  // A refused connection to "localhost" can carry an empty message, but it always has a code.
  err?.response?.data?.detail || err?.response?.data?.message || err?.message || err?.code || `Unknown ${service} error`;

const SERVICE_OF = { OCR: "ocr", AI: "ai" } as const;
const serviceUrl = (service: EvalService) => (service === "ocr" ? pythonServices.ocrUrl() : pythonServices.pipeline6Url());

/**
 * A Python service call failed:
 *   down     (refused, unreachable) the attempt fails and is retried with backoff, like an error:
 *            a server still down after the last attempt fails the sheet (ocr_unreachable /
 *            ai_unreachable), and the teacher runs it again. Nothing re-runs it on its own.
 *   busy     (503 / 429) the same
 *   timeout  fails the sheet at once (ocr_timeout / ai_timeout): retrying would hold the line for
 *            another full timeout while the server may still be working on the first call
 *   rejected (4xx) fails at once: retrying would get the same answer
 *   error    (5xx, a dropped connection) the attempt is retried with backoff
 */
async function handleServiceError(job: JobContext<any>, service: "OCR" | "AI", err: any): Promise<never> {
  const status: number | undefined = err?.response?.status;
  const detail = serviceError(service, err);
  const svc = SERVICE_OF[service];
  switch (serviceProblem(err)) {
    case "busy":
      throw new StageFailure(`${svc}_error`, `${service} server busy (${status}): ${detail}`, { permanent: false });
    case "down": {
      const waiting = (await currentSnapshot().catch(() => null))?.counts[svc === "ocr" ? "ocr" : "evaluation"].waiting;
      serviceDown(svc, detail, serviceUrl(svc), waiting);
      throw new StageFailure(`${svc}_unreachable`, `${service} server unreachable (${detail})`, { permanent: false });
    }
    case "timeout": {
      const minutes = Math.round((svc === "ocr" ? ocrTimeoutMs() : aiTimeoutMs()) / 60_000);
      throw new StageFailure(`${svc}_timeout`, `${service} server didn't answer within ${minutes} min (${detail})`, { permanent: true });
    }
    case "rejected":
      if (status === 401 || status === 403) {
        throw new StageFailure(
          `${svc}_rejected`,
          `The ${service} step was refused (${status}): ${detail}. If the ${service} server runs with INTERNAL_API_TOKEN, ` +
            `set ${service === "OCR" ? "OCR_SERVICE_TOKEN" : "EVAL_SERVICE_TOKEN"} to the same value.`,
          { permanent: true }
        );
      }
      throw new StageFailure(`${svc}_rejected`, `The ${service} step could not process this sheet (${status}): ${detail}`, { permanent: true });
    default:
      throw new StageFailure(
        `${svc}_error`,
        status ? `${service} server error ${status}: ${detail}` : `${service} server dropped the connection (${detail})`,
        { permanent: false }
      );
  }
}

/**
 * A run that didn't finish. On a sheet that already had its marks (a re-run), those marks stay:
 * the evaluation is Success again, and `error` says the re-run failed (the teacher can run it again).
 * Losing good marks to an unreachable OCR server would show the sheet as failed and unmarked, and
 * hold up the section's review for nothing. A first run is Failed, with why (`failure`: its code,
 * the detail, the attempts, the service address and the process that gave up).
 */
export async function settleFailedEvaluation(
  sheetId: string,
  error: string,
  failureKind: "permanent" | "transient",
  failure: EvaluationFailure | null = null
) {
  const row: any = await AIEvaluation.findOne({ where: { sheetId, status: "Pending" }, attributes: ["evaluations"] });
  if (!row) return;
  const hadMarks = Array.isArray(row.evaluations) && row.evaluations.length > 0;
  const saved = failure ?? { ...classifyFailureText(error), detail: error, instance: instance.id, at: new Date().toISOString() };
  // A pause asked for during the failed step has nothing left to stop.
  await AIEvaluation.update(
    (hadMarks
      ? { status: "Success", error: `Re-evaluation failed: ${error} The earlier marks are kept.`, failureKind, failure: saved, pause: null, finishedAt: new Date() }
      : { status: "Failed", error, failureKind, failure: saved, pause: null, finishedAt: new Date() }) as any,
    { where: { sheetId, status: "Pending" } }
  );
}

/** Marks the run as failed for good, with its code and a readable reason. */
async function failRun(run: EvaluationRun, stage: "OCR" | "AI evaluation", err: any, job?: JobView<any>) {
  const message = serviceError(stage === "OCR" ? "OCR" : "AI", err);
  const text = `${stage} failed: ${message}`;
  const svc: EvalService = stage === "OCR" ? "ocr" : "ai";
  const code: FailureCode = err?.failureCode ?? classifyFailureText(text).code;
  const failure: EvaluationFailure = {
    code,
    stage: svc,
    detail: message,
    ...(job ? { attempts: job.attemptsMade, maxAttempts: job.maxAttempts } : {}),
    target: serviceUrl(svc),
    instance: instance.id,
    at: new Date().toISOString(),
  };
  // A recheck re-run fails in its draft; the published evaluation stays as it was.
  if (run.recheckRequestId) {
    await failRecheckAiRun(run.recheckRequestId, text);
    return;
  }
  // So does a cross-checker's; the evaluator's marks stay as they were.
  if (run.crossCheckItemId) {
    await failCrossCheckAiRun(run.crossCheckItemId, text);
    return;
  }
  await settleFailedEvaluation(run.sheetId, text, isPermanent(err) ? "permanent" : "transient", failure).catch((e) =>
    logger.error(`[EvalQueue] Could not save the failure of sheet ${run.sheetId}: ${e?.message || e}`)
  );
}

/** "sheet VISHT…", "model answer …", "partner evaluation …" — for log lines. */
function describeJobData(data: any): string {
  if (data?.recheckRequestId) return `sheet ${data.sheetId} (recheck ${data.recheckRequestId})`;
  if (data?.crossCheckItemId) return `sheet ${data.sheetId} (cross-check ${data.crossCheckItemId})`;
  if (data?.sheetId) return `sheet ${data.sheetId}`;
  if (data?.partnerEvaluationId) return `partner evaluation ${data.partnerEvaluationId}`;
  if (data?.answerId) return `model answer ${data.answerId}`;
  return "a job";
}

/** The ids of a job's data, for JSON log lines. */
const jobFields = (data: any) => ({
  sheetId: data?.sheetId,
  runKey: data?.runKey,
  runId: data?.runId,
  examId: data?.examId,
  requestedBy: data?.requestedBy,
  answerId: data?.runKey ? undefined : data?.answerId,
  partnerEvaluationId: data?.partnerEvaluationId,
});

/** Is this run still wanted? The sheet may have been replaced, the draft closed or the run paused while it waited. */
async function runWanted(run: EvaluationRun): Promise<boolean> {
  if (run.recheckRequestId) {
    const a = await RecheckAssignment.findOne({ where: { requestId: run.recheckRequestId }, attributes: ["draft"] });
    return a?.draft?.status === "Pending";
  }
  if (run.crossCheckItemId) {
    const item = await CrossCheckItem.findOne({ where: { itemId: run.crossCheckItemId }, attributes: ["draft"] });
    return item?.draft?.status === "Pending";
  }
  const row: any = await AIEvaluation.findOne({ where: { sheetId: run.sheetId }, attributes: ["status", "pause"] });
  return Boolean(row) && !row.pause && row.status !== "Paused";
}

// ─── Pause / resume (a teacher's own sheets, from the queue page) ───────────────
//
// Pause takes the sheets that haven't started yet out of the line: they wait for OCR and nothing
// has been done for them. A sheet that has started (OCR reading it, waiting for or in the AI step,
// or waiting to retry a step) goes on to the end: stopping it half-way would throw away work the
// OCR / AI servers can't hand back, and leave it half-done. So a paused sheet never has partial
// progress, and resuming just puts it back in line (at the end: sheets queued meanwhile go first),
// with the paper and model answer as they are then.
//
// A paused sheet stays out of every automatic run (watchdog, retries) until the teacher resumes or
// evaluates it again. A paused re-evaluation keeps its earlier marks showing (status Success).

/** Who paused a sheet's run, and when (AIEvaluation.pause). */
export interface EvaluationPause {
  at: string;
  by: string | null;
  /** A re-evaluation: the earlier marks stay live while it is paused. */
  rerun?: boolean;
}

/** paused: taken out of the line · continuing: it had started, so it goes on to the end. */
export type PauseOutcome = "paused" | "continuing" | "not-queued";
export type ResumeOutcome = "queued" | "already-queued" | "not-paused" | "missing";

/** Marks the sheet paused; a re-evaluation shows its earlier marks again. */
async function markPaused(sheetId: string, by: string | null) {
  const row: any = await AIEvaluation.findOne({ where: { sheetId }, attributes: ["evaluations"] });
  if (!row) return;
  const rerun = Array.isArray(row.evaluations) && row.evaluations.length > 0;
  const pause: EvaluationPause = { at: new Date().toISOString(), by, ...(rerun ? { rerun: true } : {}) };
  await AIEvaluation.update({ status: rerun ? "Success" : "Paused", pause } as any, { where: { sheetId } });
  record("pause.done", { sheetId, rerun, by }, { msg: `Sheet ${sheetId} paused before OCR${rerun ? "; its earlier marks show meanwhile" : ""}.` });
}

/** Takes a sheet's own run out of the line if it hasn't started; one that has started goes on. */
export async function pauseEvaluation(sheetId: string, by: string | null): Promise<{ outcome: PauseOutcome }> {
  const runKey = `sheet-${sheetId}`;
  // A queuing of this sheet in progress finishes first, so its job is there to take out.
  await triggersInFlight.get(runKey)?.catch(() => undefined);
  const [ocrId, aiId] = await Promise.all([ocrQueue.dedupedJobId(runKey), aiQueue.dedupedJobId(runKey)]);
  const [ocrJob, aiJob] = await Promise.all([ocrId ? ocrQueue.getJob(ocrId) : null, aiId ? aiQueue.getJob(aiId) : null]);
  const live = (j: JobView<any> | null): j is JobView<any> => Boolean(j && !["completed", "failed", "unknown"].includes(j.state));

  // Past OCR (waiting for or in the AI step): it goes on to its marks.
  if (live(aiJob)) return { outcome: "continuing" };
  if (live(ocrJob)) {
    // Not started: waiting in line, never tried. (Running, or waiting to retry, means it has started.)
    const notStarted = ocrJob.attemptsMade === 0 && ocrJob.state !== "active";
    if (notStarted && (await ocrQueue.remove(ocrJob.id))) {
      invalidateSnapshot();
      await markPaused(sheetId, by);
      return { outcome: "paused" };
    }
    // It started (or just did, as we looked): it goes on.
    return { outcome: "continuing" };
  }
  // Pending without a job (the watchdog would queue it again): paused, nothing done.
  const row: any = await AIEvaluation.findOne({ where: { sheetId }, attributes: ["status", "pause"] });
  if (row?.status === "Pending" && !row.pause) {
    await markPaused(sheetId, by);
    return { outcome: "paused" };
  }
  return { outcome: "not-queued" };
}

/** Puts a paused sheet back in line (at the end), with the paper and model answer as they are now. */
export async function resumeEvaluation(sheetId: string, requestedBy: string | null): Promise<{ outcome: ResumeOutcome }> {
  const runKey = `sheet-${sheetId}`;
  const inFlight = triggersInFlight.get(runKey);
  if (inFlight) {
    await inFlight.catch(() => undefined);
    return { outcome: "already-queued" };
  }
  const work = (async (): Promise<{ outcome: ResumeOutcome }> => {
    const row: any = await AIEvaluation.findOne({ where: { sheetId } });
    if (!row?.pause) return { outcome: "not-paused" };
    if (await liveRun(runKey)) return { outcome: "already-queued" };
    const sheet: any = await Scanner.findOne({ where: { sheetId, isDeleted: false } });
    if (!sheet) return { outcome: "missing" };

    const ctx = await resolveSheetContext(sheet);
    const now = new Date();
    await row.update({ status: "Pending", pause: null, error: null, failureKind: null, failure: null, runOwner: instance.id, queuedAt: now, startedAt: null, finishedAt: null });
    const run: EvaluationRun = { runKey, runId: runIdFor(runKey), sheetId, ...ctx, queuedAt: now.getTime(), requestedBy };
    await ocrQueue.add("sheet", run, { jobId: `ocr-${run.runId}`, dedupeKey: runKey });
    invalidateSnapshot();
    startHeartbeat();
    startSummary();
    record("resume.queued", { sheetId, runKey, runId: run.runId, requestedBy }, { msg: `Resumed sheet ${sheetId} → back in the OCR line${requestedBy ? ` · by ${requestedBy}` : ""}.` });
    return { outcome: "queued" };
  })();
  triggersInFlight.set(runKey, work);
  return work.finally(() => triggersInFlight.delete(runKey));
}

// ─── Stage 1: OCR (port 8000) ───────────────────────────────────────────────────

async function readStudentSheet(run: EvaluationRun, sheet: any): Promise<string> {
  let studentText = String(sheet.ocrText || sheet.answerText || "");
  if (!studentText && sheet.fileBuffer?.length) {
    let fileName = sheet.fileName || "sheet.png";
    if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
      fileName += sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
    }
    record(
      "ocr.request",
      { stage: "ocr", ...jobFields(run), fileName, bytes: sheet.fileBuffer.length, mime: sheet.fileMimeType, target: pythonServices.ocrUrl(), timeoutMs: ocrTimeoutMs() },
      { msg: `OCR reading sheet ${run.sheetId}: ${fileName}, ${(sheet.fileBuffer.length / 1024 / 1024).toFixed(2)} MB (timeout ${fmtMs(ocrTimeoutMs())}).` }
    );
    studentText = await ocrDocument(sheet.fileBuffer, fileName, sheet.fileMimeType || "image/png", {
      threadId: run.runKey,
      runId: run.runId,
    });
  }
  return studentText;
}

async function runOcrStage(job: JobContext<EvaluationRun>) {
  const run = job.data;
  if (!(await runWanted(run))) {
    record("ocr.skipped", { stage: "ocr", ...jobFields(run) }, { msg: `Sheet ${run.sheetId}: run ${run.runId} is no longer wanted (paused, sheet replaced or draft closed); skipped.` });
    return { skipped: true };
  }
  const started = Date.now();
  if (!run.recheckRequestId && !run.crossCheckItemId && job.attemptsMade === 0) {
    await AIEvaluation.update({ startedAt: new Date() } as any, { where: { sheetId: run.sheetId } }).catch(() => undefined);
  }

  const sheet: any = await Scanner.findOne({ where: { sheetId: run.sheetId, isDeleted: false } });
  if (!sheet) throw new PermanentJobError("The answer sheet was deleted.");
  // Sheets stored as files keep fileBuffer null in the database; read the real bytes.
  sheet.fileBuffer = await resolveSheetBuffer(sheet);

  let studentText = "";
  try {
    // An uploaded model answer is read here too (once; its text is saved for every later student),
    // so all OCR goes through this one queue. The model answer as it is NOW: it may have been
    // replaced (deleted and uploaded again) since this sheet was queued.
    const current = await resolveSheetContext(sheet);
    if (current.answerKeyFileAnswerId) await getAnswerKeyText(current.answerKeyFileAnswerId);
    studentText = await readStudentSheet(run, sheet);
  } catch (err: any) {
    if (isServiceCallError(err)) return handleServiceError(job, "OCR", err);
    throw err;
  }
  serviceUp("ocr", pythonServices.ocrUrl());

  // Empty/weak OCR is NOT a failure: the AI stage sends the original file too, and
  // pipeline6.py reads the whole sheet from its page images in that case.
  record("ocr.text", { stage: "ocr", ...jobFields(run), chars: studentText.length, ms: Date.now() - started }, { level: "debug" });

  const ownRow = !run.recheckRequestId && !run.crossCheckItemId;
  if (ownRow) await AIEvaluation.update({ studentAnsOcr: studentText } as any, { where: { sheetId: run.sheetId } });

  // Hand over to the AI stage (while this job still holds the run, so it is never "not queued").
  // A sheet that got this far goes on to its marks, even if its teacher paused the rest.
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
    serviceUp("ocr", pythonServices.ocrUrl());
    return { chars: text?.length ?? 0 };
  } catch (err: any) {
    if (isServiceCallError(err)) return handleServiceError(job, "OCR", err);
    throw err;
  }
}

// ─── Stage 2: AI evaluation (port 8006) ─────────────────────────────────────────

/** The paper and its key as the evaluator reads them, from the rows named (re-resolved at AI time). */
async function paperMaterial(ids: { paperId: string | null; answerId: string | null; maxMarks: number }) {
  const paper = ids.paperId ? await QuestionPaper.findOne({ where: { paperId: ids.paperId } }) : null;
  const answers = ids.answerId ? await QuestionPaperAnswer.findOne({ where: { answerId: ids.answerId } }) : null;
  if (!paper) {
    return { found: false, questionText: "", typedKey: "", structured: null as ReturnType<typeof buildEvaluationPaper> | null, maxMarks: ids.maxMarks };
  }
  const flat = formatQuestionPaper(paper.content, answers ? answers.answers : null);
  const structured = buildEvaluationPaper(paper.content, answers ? answers.answers : null);
  return {
    found: true,
    questionText: flat.questions || "Evaluate student answer sheet.",
    typedKey: flat.answers,
    structured: structured.paper ? structured : null,
    maxMarks: flat.calculatedTotalMarks > 0 ? flat.calculatedTotalMarks : ids.maxMarks,
  };
}

const IMAGE_MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

/**
 * One picture of the paper (an answer diagram, a question figure) as a data URL for the AI.
 * Only inline pictures and this server's own uploads: a link to another site is never fetched.
 */
async function imageAsDataUrl(ref: string): Promise<string | null> {
  if (ref.startsWith("data:image/")) return ref;
  const local = localPathOf(ref);
  if (!local) return null;
  const mime = IMAGE_MIME[path.extname(local).toLowerCase()];
  if (!mime) return null;
  try {
    const bytes = await fs.promises.readFile(local);
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
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
    // How the marks were reached: per criterion of the teacher's marking scheme (or the default
    // plan), the diagram's check, where on the sheet the answer was, and how sure the AI is.
    ...(Array.isArray(q.criteria) && q.criteria.length ? { criteria: q.criteria } : {}),
    ...(q.diagram ? { diagram: q.diagram } : {}),
    ...(Array.isArray(q.answerPages) && q.answerPages.length ? { answerPages: q.answerPages } : {}),
    ...(q.keySource ? { keySource: q.keySource } : {}),
    ...(q.markingSource ? { markingSource: q.markingSource } : {}),
    ...(q.markingScheme ? { markingScheme: q.markingScheme } : {}),
    ...(typeof q.gradingConfidence === "number" ? { gradingConfidence: q.gradingConfidence } : {}),
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
    record("ai.skipped", { stage: "ai", ...jobFields(run) }, { msg: `Sheet ${run.sheetId}: run ${run.runId} is no longer wanted (paused, sheet replaced or draft closed); skipped.` });
    return { skipped: true };
  }
  const sheet: any = await Scanner.findOne({ where: { sheetId: run.sheetId, isDeleted: false } });
  if (!sheet) throw new PermanentJobError("The answer sheet was deleted.");
  const aiEval: any = await AIEvaluation.findOne({ where: { sheetId: run.sheetId } });
  if (!aiEval && !run.recheckRequestId && !run.crossCheckItemId) return { skipped: true };

  // Sheets stored as files keep fileBuffer null; the AI uses the page images.
  sheet.fileBuffer = await resolveSheetBuffer(sheet);
  // The paper and model answer as they are NOW. While the sheet waited in the queue the teacher
  // may have deleted the model answer and made a new one (a new row), or replaced the paper: the
  // rows named when it was queued would then be gone, and every part was marked with no key —
  // or the whole sheet as one made-up question when the paper was gone.
  const current = await resolveSheetContext(sheet);
  if (current.paperId !== run.paperId || current.answerId !== run.answerId) {
    record(
      "ai.material-changed",
      { stage: "ai", ...jobFields(run), paperId: current.paperId, answerId: current.answerId },
      { msg: `Sheet ${run.sheetId}: the question paper or model answer changed after it was queued; evaluating with the current one.` }
    );
  }
  const material = await paperMaterial(current);
  if (!material.found) {
    throw new PermanentJobError(
      "This exam has no question paper (it may have been deleted). Set the question paper, then evaluate the sheet again."
    );
  }
  const studentText = run.studentText ?? String(aiEval?.studentAnsOcr ?? "");

  // The key: the uploaded sheet's OCR text (saved by the OCR stage), else the typed answers.
  // With the structured paper the typed keys travel inside it, so only answers it couldn't
  // place go as text. An uploaded key that can't be read now fails this attempt (it is
  // retried, or the run fails saying why) instead of marking every part without a key.
  let uploadedKey = "";
  if (current.answerKeyFileAnswerId) {
    try {
      uploadedKey = (await getAnswerKeyText(current.answerKeyFileAnswerId)) ?? "";
    } catch (err: any) {
      if (isServiceCallError(err)) return handleServiceError(job, "OCR", err);
      throw err;
    }
  }
  // The uploaded key of a one-part paper is that part's key. The evaluator places an uploaded
  // key by the question labels in it, and the model answer to a one-question paper usually has
  // none: the part was then marked from the question alone.
  const placedKey = uploadedKey && material.structured ? placeUploadedKey(material.structured.paper, uploadedKey) : null;
  if (placedKey) {
    record("ai.key-placed", { stage: "ai", ...jobFields(run), part: placedKey.sourceId, chars: placedKey.text.length }, { level: "debug" });
  }
  const answerKeyText = uploadedKey || (material.structured ? material.structured.keyText : material.typedKey);

  // Pictures the AI compares diagrams with: the teacher's answer diagrams and the questions'
  // figures, inlined (the AI never downloads links), and the uploaded model answer file itself.
  const images = material.structured
    ? await inlinePaperImages(material.structured.paper, imageAsDataUrl)
    : { inlined: 0, dropped: 0, chars: 0 };
  const keyFile = current.answerKeyFileAnswerId ? await getAnswerKeyFile(current.answerKeyFileAnswerId) : null;

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
    // Uploaded model answer file: its pages are the reference for diagram parts.
    ...(keyFile ? { answer_key_pdf_base64: keyFile.buffer.toString("base64") } : {}),
  };

  record(
    "ai.request",
    {
      stage: "ai",
      ...jobFields(run),
      target: pythonServices.pipeline6Url(),
      parts: material.structured?.leaves,
      keyedParts: material.structured?.keyed,
      studentChars: studentText.length,
      withFile: Boolean(payload.student_pdf_base64),
      withKeyFile: Boolean(keyFile),
      images: images.inlined,
      imagesDropped: images.dropped,
      timeoutMs: aiTimeoutMs(),
    },
    {
      msg:
        `AI evaluating sheet ${run.sheetId}` +
        (material.structured ? ` (structured paper: ${material.structured.leaves} parts, ${material.structured.keyed} with a typed key)` : "") +
        ` — ${studentText.length} chars of OCR text${payload.student_pdf_base64 ? " + the original file" : ""} (timeout ${fmtMs(aiTimeoutMs())}).`,
    }
  );
  let evalResult: any;
  try {
    const evalResponse = await axios.post(pythonServices.pipeline6Url(), payload, {
      // The thread id puts this evaluation's LangSmith trace next to the sheet's OCR trace.
      headers: { "Content-Type": "application/json", ...serviceHeaders("eval", { threadId: run.runKey, runId: run.runId }) },
      timeout: aiTimeoutMs(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    evalResult = evalResponse.data;
  } catch (err: any) {
    return handleServiceError(job, "AI", err);
  }
  serviceUp("ai", pythonServices.pipeline6Url());

  const pipelineQuestions = mapQuestions(evalResult);
  // The pipeline cuts each answer at 300 characters; keep them whole, from the texts it was given.
  const restored = restoreFullAnswers(pipelineQuestions, { student: studentText, answerKey: answerKeyText });
  // The key placed on the paper's only part is its expected answer, should the reply leave it out.
  const mappedQuestions = placedKey
    ? restored.map((q: any) =>
        !String(q.expectedAnswer ?? "").trim() && (!placedKey.sourceId || String(q.sourceId ?? "") === placedKey.sourceId)
          ? { ...q, expectedAnswer: placedKey.text }
          : q
      )
    : restored;

  const totalObtainedScore = evalResult.summary ? evalResult.summary.obtainedMarks : (evalResult.total_score || 0);
  const overall = typeof evalResult.feedback === "object"
    ? (evalResult.feedback.overall || JSON.stringify(evalResult.feedback))
    : (evalResult.feedback || "");
  const tree = Array.isArray(evalResult.tree) && evalResult.tree.length ? evalResult.tree : null;

  if (run.recheckRequestId) {
    await finishRecheckAiRun(run.recheckRequestId, { evaluations: mappedQuestions, totalScore: Number(totalObtainedScore), feedback: overall });
    return { score: totalObtainedScore, into: "recheck draft" };
  }
  if (run.crossCheckItemId) {
    await finishCrossCheckAiRun(run.crossCheckItemId, { evaluations: mappedQuestions, totalScore: Number(totalObtainedScore), feedback: overall });
    return { score: totalObtainedScore, into: "cross-check draft" };
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
    failure: null,
    // A pause asked for after this step had started has nothing left to stop.
    pause: null,
    finishedAt: new Date(),
  });
  await sheet.update({ status: "Evaluated" });
  return { score: totalObtainedScore, questions: mappedQuestions.length };
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

/**
 * Can this process open a connection to the stage's server? Checked every 15 s (canClaim) for the
 * service health the queue page shows. Jobs are taken either way: a sheet whose server is down
 * uses its attempts and fails, instead of waiting for the server with no limit.
 */
async function canReach(svc: EvalService): Promise<boolean> {
  const url = serviceUrl(svc);
  const reachable = await serviceReachable(url);
  if (reachable) serviceUp(svc, url);
  else {
    let address = url;
    try {
      address = new URL(url).host;
    } catch {
      /* the raw value is shown */
    }
    serviceDown(svc, `no connection to ${address}`, url);
  }
  return reachable;
}

const ocrQueue = defineQueue<OcrJobData>({
  name: "evaluation-ocr",
  concurrency: ocrConcurrency,
  globalConcurrency: ocrConcurrency,
  defaults: { attempts: 4, backoff: { type: "exponential", delayMs: ocrRetryMs }, keepCompletedSec: DAY_SEC, keepFailedSec: 7 * DAY_SEC },
  lockMs: 120_000,
  maxStalls: 2,
  canClaim: async () => {
    await canReach("ocr");
    return true;
  },
  processor: (job) =>
    isRun(job.data)
      ? runOcrStage(job as JobContext<EvaluationRun>)
      : isPartner(job.data)
        ? runPartnerOcrStage(job as JobContext<PartnerJob>)
        : runAnswerKeyWarmup(job as JobContext<AnswerKeyWarmup>),
  onFailed: async (job: JobView<OcrJobData>, err) => {
    if (isRun(job.data)) await failRun(job.data, "OCR", err, job);
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
  canClaim: async () => {
    await canReach("ai");
    return true;
  },
  processor: (job) =>
    isPartner(job.data) ? runPartnerAiStage(job as JobContext<PartnerJob>) : runEvaluationStage(job as JobContext<EvaluationRun>),
  onFailed: (job, err) =>
    isPartner(job.data) ? failPartner(job.data.partnerEvaluationId, "AI", err) : failRun(job.data as EvaluationRun, "AI evaluation", err, job),
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

/**
 * Where a sheet is in the queue. Places and counts cover the whole stage, every school's sheets
 * and uploaded model answers included: they all go through the same servers, one at a time.
 */
export interface SheetQueueInfo {
  stage: QueueStage;
  /** Whose run: the sheet's own evaluation, or a recheck's / cross-checker's (those go into a draft). */
  run: "evaluation" | "recheck" | "crossCheck";
  /** 1-based place in that stage's waiting line (0 while running or waiting to retry). */
  position: number;
  /** Jobs waiting in that stage's line, and running in it now (they finish before the line moves). */
  lineLength: number;
  running: number;
  /** The attempt it is on, or makes next (1 = first try), of how many. */
  attempt: number;
  maxAttempts: number;
  /** Waiting to retry after a failed attempt, until `retryAt` (when the driver knows it). */
  retrying: boolean;
  retryAt: number | null;
  /** Why the last attempt failed, while it waits to retry. */
  lastError: string | null;
  lastErrorCode: FailureCode | null;
  /** When this stage started on it, while it runs. */
  stageStartedAt: number | null;
  queuedAt: number;
  /** The stage's server can't be reached by the processes calling it: it keeps its place and starts once it answers. */
  serviceDown: Outage | null;
  /** No process takes this stage's jobs right now: it keeps its place and goes on once one does. */
  onHold: boolean;
}

/** A stage's server that can't be reached: since when, and what the connection said. */
type Outage = { since: number; detail: string };

/** One stage's load, its server's outage if it has one, and whether anyone takes its jobs. */
export interface StageLoad {
  running: number;
  waiting: number;
  retrying: number;
  serviceDown: Outage | null;
  /**
   * No process takes this stage's jobs right now (QUEUE_WORKERS=false and no `npm run worker`, or
   * the worker died): the line doesn't move until one does. The page says so in plain words.
   */
  onHold: boolean;
}

interface QueueSnapshot {
  at: number;
  bySheet: Map<string, SheetQueueInfo>;
  byRun: Map<string, SheetQueueInfo>;
  counts: { ocr: StageLoad; evaluation: StageLoad };
  /** The processes taking jobs (null: this process can't tell). */
  workers: WorkerPresence[] | null;
}

let snapshot: QueueSnapshot | null = null;
let snapshotLoading: Promise<QueueSnapshot> | null = null;
const SNAPSHOT_TTL_MS = 2000; // the queue page polls; one read of the queues serves every poll

const isWaiting = (j: JobView<any>) => j.state === "waiting" || j.state === "prioritized";

const QUEUE_OF: Record<EvalService, string> = { ocr: "evaluation-ocr", ai: "evaluation-ai" };

/** The processes taking a stage's jobs, or null when this process can't tell. */
const takersOf = (workers: WorkerPresence[] | null, svc: EvalService): WorkerPresence[] | null =>
  workers ? workers.filter((w) => w.queues.includes(QUEUE_OF[svc])) : null;

const ownOutage = (svc: EvalService): Outage | null => {
  const o = serviceOutage(svc);
  return o ? { since: o.since, detail: o.detail } : null;
};

/** An outage another process reported with its sign of life (evaluationQueueMonitor.healthReport). */
const reportedOutage = (w: WorkerPresence, svc: EvalService): Outage | null => {
  const s: any = (w.info as any)?.services?.[svc];
  return s?.downSince ? { since: Number(s.downSince), detail: String(s.detail ?? "") } : null;
};

/**
 * A stage's server outage as the processes calling it see it. Only they can tell: with
 * QUEUE_WORKERS=false the API calls neither server, so it goes by what its workers report. Down
 * while every one of them finds it down (one that reaches it keeps the line moving), since the
 * last of them lost it.
 */
function outageOf(svc: EvalService, takers: WorkerPresence[] | null): Outage | null {
  if (!takers) return ownOutage(svc);
  // Nobody calls the server: the stage is on hold, which is what the page says.
  if (!takers.length) return null;
  let down: Outage | null = null;
  for (const w of takers) {
    const o = w.self ? ownOutage(svc) : reportedOutage(w, svc);
    if (!o) return null;
    if (!down || o.since > down.since) down = o;
  }
  return down;
}

const loadOf = (jobs: JobView<any>[], svc: EvalService, takers: WorkerPresence[] | null): StageLoad => ({
  running: jobs.filter((j) => j.state === "active").length,
  waiting: jobs.filter(isWaiting).length,
  retrying: jobs.filter((j) => j.state === "delayed").length,
  serviceDown: outageOf(svc, takers),
  onHold: Boolean(takers && !takers.length),
});

const runKind = (data: EvaluationRun): SheetQueueInfo["run"] => (data.recheckRequestId ? "recheck" : data.crossCheckItemId ? "crossCheck" : "evaluation");

function stageOf(job: JobView<any>, ocr: boolean, load: StageLoad): SheetQueueInfo {
  const data = job.data as EvaluationRun;
  const active = job.state === "active";
  const retrying = job.state === "delayed" && job.attemptsMade > 0;
  const lastError = retrying ? job.failedReason : null;
  return {
    stage: ocr ? (active ? "ocr" : "waiting_for_ocr") : active ? "evaluating" : "waiting_for_evaluation",
    run: runKind(data),
    position: job.position,
    lineLength: load.waiting,
    running: load.running,
    attempt: job.attemptsMade + 1,
    maxAttempts: job.maxAttempts,
    retrying,
    retryAt: retrying ? job.runAt ?? null : null,
    lastError,
    lastErrorCode: lastError ? classifyFailureText(`${ocr ? "OCR" : "AI evaluation"} failed: ${lastError}`).code : null,
    stageStartedAt: active ? job.processedAt : null,
    queuedAt: data.queuedAt ?? job.createdAt,
    serviceDown: active ? null : load.serviceDown,
    // Running too: a job whose worker died stays "active" until a worker comes back for it.
    onHold: load.onHold,
  };
}

async function loadSnapshot(): Promise<QueueSnapshot> {
  const [ocrJobs, aiJobs, workers] = await Promise.all([ocrQueue.liveJobs(5000), aiQueue.liveJobs(5000), queueWorkers()]);
  noteWorkers(workers, ocrJobs.length + aiJobs.length);
  // Counts are the stages' real load, partner evaluations and model answers included.
  const counts = { ocr: loadOf(ocrJobs, "ocr", takersOf(workers, "ocr")), evaluation: loadOf(aiJobs, "ai", takersOf(workers, "ai")) };
  const bySheet = new Map<string, SheetQueueInfo>();
  const byRun = new Map<string, SheetQueueInfo>();
  const place = (j: JobView<any>, ocr: boolean) => {
    if (!isRun(j.data)) return;
    const info = stageOf(j, ocr, ocr ? counts.ocr : counts.evaluation);
    byRun.set(j.data.runKey, info);
    // A sheet's own run is the one its page shows, over a recheck's or cross-checker's.
    const held = bySheet.get(j.data.sheetId);
    if (!held || held.run !== "evaluation" || info.run === "evaluation") bySheet.set(j.data.sheetId, info);
  };
  for (const j of ocrJobs) place(j, true);
  // The AI stage wins: during the hand-over a run briefly sits in both.
  for (const j of aiJobs) place(j, false);
  return { at: Date.now(), bySheet, byRun, counts, workers };
}

// ─── Is anyone taking the evaluation jobs? ──────────────────────────────────────
//
// An API started with QUEUE_WORKERS=false only adds jobs; without a worker process sheets wait and
// nothing reaches OCR. The page says "on hold" in plain words; developers get the how-to here, on
// the console, once when the last worker goes and once when one is back.

let takersSeen: boolean | null = null;

function noteWorkers(workers: WorkerPresence[] | null, jobs: number) {
  if (!workers) return;
  const takers = workers.filter((w) => w.queues.includes(QUEUE_OF.ocr) || w.queues.includes(QUEUE_OF.ai));
  const any = takers.length > 0;
  if (any === takersSeen) return;
  const before = takersSeen;
  takersSeen = any;
  if (!any) {
    record(
      "workers.none",
      { schema: queueConfig.schema, jobs },
      {
        level: "warn",
        msg:
          `No queue worker is running (queue schema "${queueConfig.schema}"): sheets wait in line and nothing reaches OCR or AI evaluation` +
          (jobs ? ` (${jobs} job(s) in the evaluation queues now)` : "") +
          `. Start one with "npm run worker" (on the server: the pm2 "worker" app), or run the API without QUEUE_WORKERS=false.`,
      }
    );
  } else if (before === false) {
    record(
      "workers.back",
      { workers: takers.map((w) => w.instance) },
      { msg: `Queue worker running (${takers.map((w) => w.instance).join(", ")}): the evaluation line moves again.` }
    );
  }
}

let snapshotGeneration = 0;

/** The line just changed here (queued, paused, resumed): the next read sees it, not a cached copy. */
function invalidateSnapshot() {
  snapshotGeneration++;
  snapshot = null;
  snapshotLoading = null;
}

async function currentSnapshot(fresh = false): Promise<QueueSnapshot> {
  if (!fresh && snapshot && Date.now() - snapshot.at < SNAPSHOT_TTL_MS) return snapshot;
  if (!snapshotLoading) {
    const generation = snapshotGeneration;
    const loading: Promise<QueueSnapshot> = loadSnapshot()
      .then((s) => {
        // A read started before the line changed is still answered, but not kept.
        if (generation === snapshotGeneration) snapshot = s;
        return s;
      })
      .finally(() => {
        if (snapshotLoading === loading) snapshotLoading = null;
      });
    snapshotLoading = loading;
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

// ─── Heartbeat: live runs keep their rows fresh ─────────────────────────────────

/** Six beats fit in the watchdog's 3-minute grace, so a few slow database calls lose nothing. */
const HEARTBEAT_EVERY_MS = 30_000;
let heartbeatTimer: NodeJS.Timeout | null = null;

/**
 * Every API process sharing this database runs the watchdog, which takes over a Pending row that
 * hasn't changed for 3 minutes and has no job in ITS queue. A process with in-process queues (or
 * another queue database) can't see this one's jobs: without this beat it queues them again and,
 * if its OCR / AI address doesn't work, fails them while they are still waiting here. That is how
 * sheets "failed after a while" until 2026-11: an older API on the database server took them over.
 *
 * The beat is raw SQL on purpose: Sequelize skips an UPDATE that only sets updatedAt, so the
 * earlier version of this beat never wrote anything. With in-process queues, a row another process
 * marked Failed while its run is still live here goes back to Pending, with a warning that names
 * what it wrote (with a shared queue, "live" includes other processes' runs, so it is left alone).
 */
async function beat() {
  const keys = [...(await currentSnapshot(true)).byRun.keys()];
  if (!keys.length) return;
  const idsOf = (prefix: string) => keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  const sheetIds = idsOf("sheet-");
  if (sheetIds.length && queueDriverKind() === "memory") {
    const restored = (await sequelize.query(
      `UPDATE "viaexam_ai_evaluations"
          SET status = 'Pending', error = NULL, "failureKind" = NULL, failure = NULL, "finishedAt" = NULL, "updatedAt" = now()
        WHERE "sheetId" IN (:ids) AND status = 'Failed' AND (failure IS NULL OR failure->>'instance' IS DISTINCT FROM :instance)
        RETURNING "sheetId", error`,
      { replacements: { ids: sheetIds, instance: instance.id }, type: QueryTypes.SELECT }
    )) as Array<{ sheetId: string; error: string | null }>;
    for (const row of restored) {
      record(
        "run.restored",
        { sheetId: row.sheetId, foreignError: row.error },
        {
          level: "warn",
          msg:
            `Sheet ${row.sheetId} was marked failed by another API process ("${row.error ?? ""}") while it is still in line here. ` +
            "Back to Pending; this process finishes it. See the warning about other API processes on this database.",
        }
      );
    }
  }
  const touch = (table: string, column: string, ids: string[], extra = "") =>
    ids.length
      ? sequelize.query(`UPDATE "${table}" SET "updatedAt" = now() WHERE "${column}" IN (:ids)${extra}`, { replacements: { ids } })
      : Promise.resolve();
  await Promise.all([
    touch("viaexam_ai_evaluations", "sheetId", sheetIds, ` AND status = 'Pending'`),
    touch("viaexam_recheck_assignments", "requestId", idsOf("recheck-")),
    touch("viaexam_cross_check_items", "itemId", idsOf("cross-")),
  ]);
}

function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    beat().catch((err) => record("heartbeat.error", { error: String(err?.message || err) }, { level: "warn", msg: `Could not refresh the rows of live runs: ${err?.message || err}` }));
  }, HEARTBEAT_EVERY_MS);
  heartbeatTimer.unref?.();
}

// ─── Log of the evaluation queue (see evaluationQueueMonitor.ts) ────────────────

const STAGE_OF_QUEUE: Record<string, { svc: EvalService; label: "OCR" | "AI" }> = {
  "evaluation-ocr": { svc: "ocr", label: "OCR" },
  "evaluation-ai": { svc: "ai", label: "AI" },
};
const queueOf = (svc: EvalService) => (svc === "ocr" ? ocrQueue : aiQueue);
const failureCodeOf = (svc: EvalService, e: QueueEvent): FailureCode =>
  (e.errorCode as FailureCode) || classifyFailureText(`${svc === "ocr" ? "OCR" : "AI evaluation"} failed: ${e.error ?? ""}`).code;

/** What runs next in a stage once `doneId` is out: the job that just started, else the first in line. */
async function nextIn(svc: EvalService, doneId: string, at: number) {
  const jobs = await queueOf(svc).liveJobs(1000);
  const waiting = jobs.filter((j) => isWaiting(j) && j.id !== doneId);
  const started = jobs.find((j) => j.state === "active" && j.id !== doneId && (j.processedAt ?? 0) >= at - 1000);
  const next = started ?? waiting[0];
  return next ? { subject: describeJobData(next.data), jobId: next.id, startsNow: Boolean(started), waiting: waiting.length - (started ? 0 : 1) } : null;
}

const describeNext = (svc: EvalService, label: string, n: Awaited<ReturnType<typeof nextIn>>) => {
  if (!n) return `Nothing else in the ${label} line.`;
  const rest = n.waiting > 0 ? `, ${n.waiting} more waiting` : "";
  if (n.startsNow) return `Next: ${n.subject} (started now${rest}).`;
  if (serviceOutage(svc)) return `Next: ${n.subject} — waits until the ${label} service answers${rest}.`;
  return `Next: ${n.subject}${rest}.`;
};

onQueueEvent(async (e: QueueEvent) => {
  const stage = STAGE_OF_QUEUE[e.queue];
  const job = e.job;
  // Pauses of the whole stage are logged by canReach() / handleServiceError with their reason.
  if (!stage || !job) return;
  startHeartbeat();
  startSummary();
  const data: any = job.data;
  const subject = describeJobData(data);
  const fields = {
    queue: e.queue,
    stage: stage.svc,
    jobId: job.id,
    ...jobFields(data),
    state: job.state,
    position: job.position || undefined,
    maxAttempts: job.maxAttempts,
    delayMs: e.delayMs,
    durationMs: e.durationMs,
    error: e.error,
  };
  const tries = (n: number) => (job.maxAttempts > 1 ? ` · attempt ${n}/${job.maxAttempts}` : "");

  switch (e.type) {
    case "added":
      // The trigger writes the readable line (with who asked); the AI hand-over is in the OCR "done" line.
      record(`${stage.svc}.queued`, fields, { level: "debug" });
      return;
    case "deduplicated":
      record(`${stage.svc}.deduplicated`, fields, { msg: `${subject} is already in the ${stage.label} queue (job ${job.id}): the repeated request added nothing.` });
      return;
    case "active": {
      const n = await nextIn(stage.svc, job.id, Number.POSITIVE_INFINITY);
      const waitedMs = job.attemptsMade ? undefined : Math.max(0, (job.processedAt ?? e.at) - job.createdAt);
      record(
        `${stage.svc}.started`,
        { ...fields, attempt: job.attemptsMade + 1, waitedMs, next: n?.subject, waiting: n ? n.waiting + 1 : 0 },
        {
          msg:
            `${stage.label} started · ${subject}${tries(job.attemptsMade + 1)}` +
            (waitedMs !== undefined ? ` · waited ${fmtMs(waitedMs)} in line` : " · retry") +
            ` · ${n ? `next in line: ${n.subject}${n.waiting > 0 ? ` (+${n.waiting} more)` : ""}` : "nothing else waiting"}.`,
        }
      );
      return;
    }
    case "completed": {
      const rv: any = job.returnValue ?? {};
      let what = "";
      if (rv.skipped) what = " (skipped: paused or no longer wanted)";
      else if (stage.svc === "ocr" && typeof rv.chars === "number") what = ` · ${rv.chars} chars of text`;
      else if (stage.svc === "ai" && rv.score !== undefined) what = ` · ${rv.score} marks${rv.into ? ` (into the ${rv.into})` : ""}`;
      let then = "";
      if (stage.svc === "ocr" && isRun(data) && !rv.skipped) {
        const handedTo = await aiQueue.getJob(`ai-${data.runId}`);
        if (handedTo) then = handedTo.state === "active" ? " → AI evaluating it now" : ` → in line for AI${handedTo.position ? ` (#${handedTo.position})` : ""}`;
      }
      if (stage.svc === "ai" && data?.queuedAt) then = ` · ${fmtMs(e.at - data.queuedAt)} since it was queued`;
      const n = await nextIn(stage.svc, job.id, e.at);
      record(
        `${stage.svc}.done`,
        { ...fields, result: rv, next: n?.subject },
        { msg: `${stage.label} done · ${subject}${what} in ${fmtMs(e.durationMs)}${then}. ${describeNext(stage.svc, stage.label, n)}` }
      );
      return;
    }
    case "retrying": {
      const code = failureCodeOf(stage.svc, e);
      record(
        `${stage.svc}.retry`,
        { ...fields, attempt: job.attemptsMade, errorCode: code, retryAt: job.runAt ? new Date(job.runAt).toISOString() : undefined },
        {
          level: "warn",
          msg: `${stage.label} attempt ${job.attemptsMade}/${job.maxAttempts} failed · ${subject} after ${fmtMs(e.durationMs)} · ${code}: ${e.error} · retry in ${fmtMs(e.delayMs)}.`,
        }
      );
      return;
    }
    case "failed": {
      const code = failureCodeOf(stage.svc, e);
      const n = await nextIn(stage.svc, job.id, e.at);
      record(
        `${stage.svc}.failed`,
        { ...fields, attempts: job.attemptsMade, errorCode: code, next: n?.subject },
        {
          level: "error",
          msg:
            `FAILED at ${stage.label} · ${subject} · ${code} after ${job.attemptsMade} attempt(s)` +
            (data?.queuedAt ? `, ${fmtMs(e.at - data.queuedAt)} since it was queued` : "") +
            `: ${e.error}. ${describeNext(stage.svc, stage.label, n)}`,
        }
      );
      return;
    }
    case "rate-limited":
      record(`${stage.svc}.paused`, fields, { level: "debug" });
      return;
    default:
      return;
  }
});

// A summary of the evaluation queue every minute while it has work (and once when it empties).
const SUMMARY_EVERY_MS = 60_000;
let summaryTimer: NodeJS.Timeout | null = null;
let summaryWasEmpty = true;

function startSummary() {
  if (summaryTimer) return;
  summaryTimer = setInterval(() => void summarize().catch(() => undefined), SUMMARY_EVERY_MS);
  summaryTimer.unref?.();
}

async function summarize() {
  const [ocrJobs, aiJobs, workers] = await Promise.all([ocrQueue.liveJobs(1000), aiQueue.liveJobs(1000), queueWorkers()]);
  noteWorkers(workers, ocrJobs.length + aiJobs.length);
  if (!ocrJobs.length && !aiJobs.length) {
    if (!summaryWasEmpty) record("queue.summary", { ocr: { running: 0, waiting: 0, retrying: 0 }, ai: { running: 0, waiting: 0, retrying: 0 } }, { msg: "Queue empty: nothing waiting for OCR or AI evaluation." });
    summaryWasEmpty = true;
    return;
  }
  summaryWasEmpty = false;
  const now = Date.now();
  const part = (label: string, svc: EvalService, jobs: JobView<any>[], timeoutMs: number) => {
    const running = jobs
      .filter((j) => j.state === "active")
      .map((j) => {
        const ran = now - (j.processedAt ?? now);
        return `${describeJobData(j.data)} for ${fmtMs(ran)}${j.maxAttempts > 1 ? ` (attempt ${j.attemptsMade + 1}/${j.maxAttempts})` : ""}${ran > timeoutMs * 0.75 ? ` — near its ${fmtMs(timeoutMs)} timeout` : ""}`;
      });
    const load = loadOf(jobs, svc, takersOf(workers, svc));
    const outage = load.serviceDown;
    return {
      text:
        `${label}: ${running.length ? `running ${running.join("; ")}` : "idle"} · ${load.waiting} waiting` +
        (load.retrying ? ` · ${load.retrying} waiting to retry` : "") +
        (outage ? ` · SERVICE UNREACHABLE since ${new Date(outage.since).toISOString().slice(11, 19)} UTC (${outage.detail})` : "") +
        (load.onHold ? ` · ON HOLD: no queue worker running ("npm run worker")` : ""),
      fields: {
        running: load.running,
        waiting: load.waiting,
        retrying: load.retrying,
        runningJobs: jobs.filter((j) => j.state === "active").map((j) => j.id),
        serviceDown: outage ?? undefined,
        onHold: load.onHold || undefined,
      },
    };
  };
  const ocr = part("OCR", "ocr", ocrJobs, ocrTimeoutMs());
  const ai = part("AI", "ai", aiJobs, aiTimeoutMs());
  record("queue.summary", { ocr: ocr.fields, ai: ai.fields }, { msg: `Queue — ${ocr.text} | ${ai.text}` });
}

// ─── Diagnostics (developers: GET /v1/ai-evaluation/queue/diagnostics) ──────────

const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : null);

/** Everything about the evaluation queue this process knows, in one answer. */
export async function queueDiagnostics() {
  const [ocrJobs, aiJobs, snap, others] = await Promise.all([
    ocrQueue.liveJobs(2000),
    aiQueue.liveJobs(2000),
    currentSnapshot(true),
    checkOtherQueueProcesses(),
  ]);
  const now = Date.now();
  const describeJob = (j: JobView<any>) => ({
    jobId: j.id,
    kind: isRun(j.data) ? runKind(j.data) : isPartner(j.data) ? "partner" : "answerKey",
    subject: describeJobData(j.data),
    ...jobFields(j.data),
    state: j.state,
    position: j.position || null,
    attempt: j.attemptsMade + 1,
    maxAttempts: j.maxAttempts,
    queuedAt: iso((j.data as any)?.queuedAt ?? j.createdAt),
    runningFor: j.state === "active" && j.processedAt ? fmtMs(now - j.processedAt) : null,
    retryAt: iso(j.runAt),
    lastError: j.failedReason,
  });
  const recentFailures = await AIEvaluation.findAll({
    where: { error: { [Op.ne]: null }, finishedAt: { [Op.gte]: new Date(now - DAY_SEC * 1000) } } as any,
    attributes: ["sheetId", "status", "error", "failureKind", "failure", "runCount", "finishedAt"],
    order: [["finishedAt", "DESC"]],
    limit: 50,
  }).catch(() => []);

  const warnings: string[] = [];
  if (others.length && queueDriverKind() === "memory") {
    warnings.push(
      `Another API process runs the PostgreSQL job queue on this database (${others.map((o) => o.client).join(", ")}), while this one keeps its ` +
        "jobs in memory: neither sees the other's queue. Run every API on this database with QUEUE_DRIVER=postgres, or stop the other one."
    );
  }
  if (snap.counts.ocr.onHold || snap.counts.evaluation.onHold) {
    warnings.push(
      `No process takes this queue's jobs (schema "${queueConfig.schema}"): sheets wait and nothing reaches OCR or AI evaluation. ` +
        `Start the worker ("npm run worker"; on the server the pm2 "worker" app), or run the API without QUEUE_WORKERS=false.`
    );
  }
  // As the processes calling the services see them (an API with QUEUE_WORKERS=false calls neither).
  for (const [label, load] of [["OCR", snap.counts.ocr], ["AI evaluation", snap.counts.evaluation]] as const) {
    const o = load.serviceDown;
    if (o) warnings.push(`The ${label} service has been unreachable since ${new Date(o.since).toISOString()} (${o.detail}); its stage waits.`);
  }
  const foreignTargets = new Set(
    recentFailures
      .map((r: any) => r.failure?.target ?? /(\d{1,3}(?:\.\d{1,3}){3}:\d+)/.exec(String(r.error))?.[1])
      .filter((t: any) => t && !String(pythonServices.ocrUrl()).includes(String(t)) && !String(pythonServices.pipeline6Url()).includes(String(t)))
  );
  if (foreignTargets.size) {
    warnings.push(`Failures in the last 24 hours name service addresses this process doesn't use (${[...foreignTargets].join(", ")}): another API process with a different configuration handled those sheets.`);
  }

  return {
    instance: { ...instance, queueDriver: queueDriverKind(), runsWorkers: queueWorkersRunningHere(), queueSchema: queueConfig.schema },
    // Who takes the jobs: every process that runs workers, with the outages it sees.
    workers:
      snap.workers?.map((w) => ({
        instance: w.instance,
        self: w.self,
        startedAt: iso(w.startedAt),
        lastSeenAt: iso(w.lastSeenAt),
        queues: w.queues,
        services: (w.info as any)?.services ?? null,
      })) ?? null,
    config: {
      ocrUrl: pythonServices.ocrUrl(),
      evalUrl: pythonServices.pipeline6Url(),
      ocrTimeoutMin: Math.round(ocrTimeoutMs() / 60_000),
      aiTimeoutMin: Math.round(aiTimeoutMs() / 60_000),
      ocrConcurrency,
      evalConcurrency,
      attempts: { ocr: 4, ai: 5 },
      retryDelayMs: { ocr: ocrRetryMs, ai: evalRetryMs },
      heartbeatMs: HEARTBEAT_EVERY_MS,
    },
    services: servicesHealth(),
    stages: {
      ocr: { ...snap.counts.ocr, jobs: ocrJobs.map(describeJob) },
      evaluation: { ...snap.counts.evaluation, jobs: aiJobs.map(describeJob) },
    },
    otherQueueProcesses: others,
    warnings,
    recentFailures,
    recentEvents: recentEvents(200),
  };
}

/** Started with the workers: the warning about other queue processes on this database. */
export function startEvaluationQueueMonitor(): void {
  watchOtherQueueProcesses();
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

type TriggerOptions = { requestedBy?: string | null; withQueueInfo?: boolean };

/**
 * Requests for the same sheet that arrive together (a double click, a page that loads twice) share
 * one: the first queues it, the others get its answer. Without this both pass the "already queued"
 * check before either has added its job.
 */
const triggersInFlight = new Map<string, Promise<any>>();

export const triggerPipeline6Evaluation = async (
  sheetId: string,
  force: boolean = false,
  /** A recheck teacher's re-run on a published sheet: the outcome goes into the recheck's draft. */
  recheck: RecheckContext | null = null,
  /** A cross-checker's re-run: the outcome goes into their cross-check draft. */
  crossCheck: CrossCheckContext | null = null,
  /** `withQueueInfo: false` skips reading the queue for this sheet's place (a batch reads it once). */
  options: TriggerOptions = {}
): Promise<any> => {
  const flightKey = recheck ? `recheck-${recheck.request.requestId}` : crossCheck ? `cross-${crossCheck.item.itemId}` : `sheet-${sheetId}`;
  const inFlight = triggersInFlight.get(flightKey);
  if (inFlight) {
    const first = await inFlight;
    record("trigger.joined", { runKey: flightKey, sheetId, requestedBy: options.requestedBy }, { msg: `Sheet ${sheetId}: a second request arrived while the first was queuing it; it shares the first one's run.` });
    return first?.error ? first : { ...first, message: msg("This sheet is already queued for evaluation.") };
  }
  const work = queueEvaluation(sheetId, force, recheck, crossCheck, options).finally(() => triggersInFlight.delete(flightKey));
  triggersInFlight.set(flightKey, work);
  return work;
};

async function queueEvaluation(
  sheetId: string,
  force: boolean,
  recheck: RecheckContext | null,
  crossCheck: CrossCheckContext | null,
  options: TriggerOptions
): Promise<any> {
  const placeOf = async (runKey: string) =>
    options.withQueueInfo === false ? null : (await currentSnapshot(true)).byRun.get(runKey) ?? null;
  try {
    const sheet: any = (await Scanner.findOne({ where: { sheetId, isDeleted: false } })) || (await Scanner.findByPk(sheetId));
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: msg("Scanner sheet not found.") };
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
      record(
        "trigger.already-queued",
        { sheetId, runKey, requestedBy: options.requestedBy, stage: queue?.stage, position: queue?.position },
        { msg: `Sheet ${sheetId} is already in line${queue ? ` (${queue.stage}${queue.position ? `, #${queue.position} of ${queue.lineLength}` : ""})` : ""}: nothing added.` }
      );
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: msg("This sheet is already queued for evaluation."),
        data: aiEval ? { ...aiEval.get({ plain: true }), ...(recheck || crossCheck ? { status: "Pending" } : {}), queue } : null,
      };
    }

    if (aiEval && aiEval.status === "Success" && !force && !recheck && !crossCheck) {
      return { error: false, statusCode: httpStatus.OK, message: msg("Sheet already evaluated."), data: aiEval };
    }

    const ctx = await resolveSheetContext(sheet);
    const now = new Date();

    // ── Evaluation record → Pending (the queue page polls this) ──
    // runOwner: the process holding the run (its in-memory queue dies with it; see the watchdog).
    // A paused sheet evaluated again starts over (its pause is cleared).
    const pending = { status: "Pending", error: null, failureKind: null, failure: null, pause: null, runOwner: instance.id, queuedAt: now, startedAt: null, finishedAt: null };
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
    invalidateSnapshot();
    startHeartbeat();
    startSummary();

    const queue = await placeOf(runKey);
    const kind = recheck ? " (recheck run, into its draft)" : crossCheck ? " (cross-check run, into its draft)" : force && aiEval?.evaluations?.length ? " (re-evaluation; the earlier marks stay until it succeeds)" : "";
    record(
      "trigger.queued",
      {
        sheetId,
        runKey,
        runId: run.runId,
        examId: run.examId,
        requestedBy: run.requestedBy,
        stage: queue?.stage,
        position: queue?.position,
        lineLength: queue?.lineLength,
        running: queue?.running,
        onHold: queue?.onHold || undefined,
      },
      {
        level: queue?.onHold ? "warn" : "info",
        msg:
          `Queued sheet ${sheetId}${kind}` +
          (queue
            ? queue.stage === "waiting_for_ocr"
              ? ` → OCR line #${queue.position} of ${queue.lineLength}${queue.running ? ` (${queue.running} being read now)` : ""}`
              : ` → ${queue.stage === "ocr" ? "OCR started at once" : queue.stage}`
            : "") +
          (run.requestedBy ? ` · requested by ${run.requestedBy}` : "") +
          (queue?.onHold ? ` — ON HOLD: no queue worker is running, so it waits until one starts ("npm run worker")` : "") +
          ".",
      }
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message:
        queue && queue.stage === "waiting_for_ocr" && queue.position > 0
          ? msg("Queued for AI evaluation (position {{position}}).", { position: queue.position })
          : msg("AI evaluation started."),
      data: { ...aiEval.get({ plain: true }), ...(recheck || crossCheck ? { status: "Pending" } : {}), queue },
    };
  } catch (error: any) {
    record("trigger.error", { sheetId, error: String(error?.message || error) }, { level: "error", msg: `Could not queue sheet ${sheetId}: ${error?.stack || error?.message || error}` });
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: msg("Failed to queue the AI evaluation: {{error}}", { error: error?.message || String(error) }),
    };
  }
}

export default {
  triggerPipeline6Evaluation,
  getSheetQueueInfo,
  getSheetsQueueInfo,
  getQueueSnapshot,
  liveRunKeys,
  warmAnswerKeyOcr,
  queueDiagnostics,
};
