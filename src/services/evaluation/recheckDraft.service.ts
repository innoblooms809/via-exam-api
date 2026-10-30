/**
 * A recheck teacher re-evaluates a published sheet on the normal evaluation screen.
 *
 * Results are published, so nobody changes the live evaluation (the student reads it). The
 * one exception is the teacher the admin gave an open recheck to: on that sheet they may run
 * the AI again and change the question-wise marks, but all of it lands in a draft on the
 * recheck (RecheckAssignment.draft). The student, the admin's result and everyone else keep
 * seeing the published marks. The teacher's decision sends the draft for approval, and only
 * the admin's approval copies it into the evaluation and the result (examWorkflow.service).
 */

import httpStatus from "http-status";
import AIEvaluation from "../../models/AIEvaluation.model";
import Exam from "../../models/Exam.model";
import Scanner from "../../models/Scanner.model";
import StudentResult from "../../models/StudentResult.model";
import RecheckRequest, { recheckCategoryLabel } from "../../models/RecheckRequest.model";
import RecheckAssignment, { type RecheckDraft } from "../../models/RecheckAssignment.model";
import ApiError from "../../utils/ApiError";
import logger from "../../config/logger";
import { questionChanges, totalOf } from "../../utils/questionMarks";
import { isTeacherRequester } from "./evaluationAccess.service";
import { assertCrossCheckEditable, crossCheckFor, type CrossCheckContext } from "./crossCheckDraft.service";
import { sheetHeldForCrossCheck } from "../exam/crossCheck.service";

export interface RecheckContext {
  request: RecheckRequest;
  assignment: RecheckAssignment;
  evaluation: AIEvaluation;
  /** The teacher may still change it (Under Review, decision not sent). */
  editable: boolean;
}

/**
 * The recheck of this sheet the admin gave this teacher, while it is with them (re-evaluating,
 * or their decision awaiting approval). Null for anyone else and for any other sheet.
 */
export async function recheckFor(user: any, sheetId: string): Promise<RecheckContext | null> {
  if (!isTeacherRequester(user) || !sheetId) return null;
  const evaluation = await AIEvaluation.findOne({ where: { sheetId } });
  if (!evaluation?.evaluationId) return null;
  const request = await RecheckRequest.findOne({ where: { evaluationId: evaluation.evaluationId, status: ["Under Review", "Awaiting Approval"] } });
  if (!request) return null;
  const assignment = await RecheckAssignment.findOne({ where: { requestId: request.requestId, teacherId: user.userId } });
  if (!assignment) return null;
  return { request, assignment, evaluation, editable: request.status === "Under Review" && !assignment.completedAt };
}

/** Have this sheet's exam results been published? */
export async function sheetPublished(sheetId: string): Promise<boolean> {
  const sheet = await Scanner.findOne({ where: { sheetId }, attributes: ["examId"] });
  return Boolean(sheet?.examId && (await StudentResult.count({ where: { examId: sheet.examId, isDeleted: false } })));
}

/**
 * Before anyone runs the AI on a sheet. Published results never get re-evaluated in place:
 * the recheck teacher's run goes into their draft, anyone else is refused. A sheet in an open
 * cross-check is re-evaluated only by its cross-checker, into their draft.
 */
export async function evaluationRunFor(user: any, sheetId: string): Promise<{ recheck: RecheckContext | null; crossCheck: CrossCheckContext | null }> {
  const recheck = await recheckFor(user, sheetId);
  if (recheck) {
    assertEditable(recheck);
    return { recheck, crossCheck: null };
  }
  if (await sheetPublished(sheetId)) {
    throw new ApiError(httpStatus.CONFLICT, "This exam's results are published, so its sheets aren't evaluated again. Marks change only through a recheck the admin assigns.");
  }
  const crossCheck = await crossCheckFor(user, sheetId);
  if (crossCheck) {
    assertCrossCheckEditable(crossCheck);
    return { recheck: null, crossCheck };
  }
  if (await sheetHeldForCrossCheck(sheetId)) {
    throw new ApiError(httpStatus.CONFLICT, "This sheet is being cross-checked. Its marks change only through the cross-checker's verdict until that's done.");
  }
  return { recheck: null, crossCheck: null };
}

/**
 * On every route that runs the AI on a sheet (after the access check): refuses published
 * sheets, and marks a recheck teacher's run (req.recheck) or a cross-checker's
 * (req.crossCheck) so it goes into their draft.
 */
export const evaluationRunGuard = async (req: any, res: any, next: any) => {
  const sheetId = String(req.body?.sheetId ?? req.params?.sheetId ?? "");
  if (!sheetId) return next();
  try {
    const run = await evaluationRunFor(req.viaExamUser, sheetId);
    req.recheck = run.recheck;
    req.crossCheck = run.crossCheck;
    return next();
  } catch (err: any) {
    const statusCode = err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
    return res.status(statusCode).json({ error: true, statusCode, message: err?.message || "This sheet can't be evaluated now." });
  }
};

/** The published marks, or the draft's when the teacher has re-evaluated. */
const draftOf = (ctx: RecheckContext): RecheckDraft | null => {
  const d = ctx.assignment.draft;
  return d && (d.evaluations?.length || d.status === "Pending") ? d : null;
};

/**
 * What the recheck teacher's evaluation screen shows: their draft over the published
 * evaluation, and the recheck itself (the claim, the published marks, what changed).
 */
export function recheckView(plain: any, ctx: RecheckContext) {
  const draft = draftOf(ctx);
  const evaluations = draft?.evaluations?.length ? draft.evaluations : plain.evaluations;
  const changes = questionChanges(ctx.evaluation.evaluations, evaluations);
  const published = ctx.evaluation.totalScore == null ? null : Number(ctx.evaluation.totalScore);
  return {
    ...plain,
    evaluations,
    totalScore: draft?.totalScore ?? published,
    feedback: draft?.feedback ?? plain.feedback,
    // The AI re-run is the draft's, not the live evaluation's.
    status: draft?.status === "Pending" ? "Pending" : plain.status,
    error: draft?.status === "Failed" ? (draft.error ?? "The AI couldn't re-evaluate this sheet.") : plain.error,
    canEvaluate: ctx.editable,
    recheck: {
      requestId: ctx.request.requestId,
      status: ctx.request.status,
      editable: ctx.editable,
      category: ctx.request.category,
      categoryLabel: recheckCategoryLabel(ctx.request.category),
      questions: ctx.request.questions ?? [],
      reason: ctx.request.reason,
      publishedScore: published,
      draftScore: draft?.totalScore ?? null,
      aiStatus: draft?.status ?? null,
      aiRunAt: draft?.aiRunAt ?? null,
      editedAt: draft?.editedAt ?? null,
      changes,
      returnNote: ctx.assignment.returnNote,
      returnedAt: ctx.assignment.returnedAt,
      decision: ctx.assignment.completedAt
        ? { revisedScore: ctx.assignment.revisedScore == null ? null : Number(ctx.assignment.revisedScore), note: ctx.assignment.teacherNote, sentAt: ctx.assignment.completedAt }
        : null,
    },
  };
}

const assertEditable = (ctx: RecheckContext) => {
  if (!ctx.editable) {
    throw new ApiError(
      httpStatus.CONFLICT,
      ctx.request.status === "Awaiting Approval"
        ? "Your recheck decision is with the admin for approval. If they send it back, you can change it again."
        : "This recheck is not open for you to change."
    );
  }
};

/** The recheck teacher saves question-wise marks: into the draft, never the live evaluation. */
export async function saveRecheckDraft(ctx: RecheckContext, data: { evaluations?: any; totalScore?: unknown; feedback?: string }) {
  assertEditable(ctx);
  if (ctx.assignment.draft?.status === "Pending") throw new ApiError(httpStatus.CONFLICT, "The AI is re-evaluating this sheet. Wait for it to finish, then change the marks.");
  const evaluations = Array.isArray(data.evaluations) ? data.evaluations : (ctx.assignment.draft?.evaluations ?? ctx.evaluation.evaluations ?? []);
  const sheet = await Scanner.findOne({ where: { sheetId: ctx.evaluation.sheetId }, attributes: ["examId"] });
  const exam = sheet?.examId ? await Exam.findOne({ where: { examId: sheet.examId }, attributes: ["totalMarks"] }) : null;
  const given = data.totalScore === undefined || data.totalScore === null || data.totalScore === "" ? null : Number(data.totalScore);
  const total = given ?? totalOf(evaluations);
  if (total != null && (!Number.isFinite(total) || total < 0 || (exam && total > exam.totalMarks))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Marks must be between 0 and ${exam?.totalMarks ?? "the paper's maximum"}.`);
  }
  const draft: RecheckDraft = {
    evaluations,
    totalScore: total == null ? null : Math.round(total * 100) / 100,
    feedback: data.feedback !== undefined ? data.feedback : (ctx.assignment.draft?.feedback ?? ctx.evaluation.feedback ?? null),
    status: "Ready",
    error: null,
    aiRunAt: ctx.assignment.draft?.aiRunAt ?? null,
    editedAt: new Date().toISOString(),
  };
  await ctx.assignment.update({ draft });
  ctx.assignment.draft = draft;
  return draft;
}

/** An AI re-run for the recheck starts: the draft waits for it (the live evaluation is untouched). */
export async function startRecheckAiRun(ctx: RecheckContext) {
  assertEditable(ctx);
  const prev = ctx.assignment.draft;
  await ctx.assignment.update({
    draft: {
      evaluations: prev?.evaluations ?? [],
      totalScore: prev?.totalScore ?? null,
      feedback: prev?.feedback ?? null,
      status: "Pending",
      error: null,
      aiRunAt: prev?.aiRunAt ?? null,
      editedAt: prev?.editedAt ?? null,
    },
  });
}

/** The AI's re-evaluation of a recheck sheet: into the draft. */
export async function finishRecheckAiRun(requestId: string, result: { evaluations: any[]; totalScore: number | null; feedback: string | null }) {
  const assignment = await RecheckAssignment.findOne({ where: { requestId } });
  if (!assignment) return;
  await assignment.update({
    draft: { ...result, status: "Ready", error: null, aiRunAt: new Date().toISOString(), editedAt: null },
  });
}

/** The AI re-run failed: the draft keeps the marks it had. */
export async function failRecheckAiRun(requestId: string, error: string) {
  const assignment = await RecheckAssignment.findOne({ where: { requestId } });
  if (!assignment) return;
  const prev = assignment.draft;
  await assignment
    .update({
      draft: {
        evaluations: prev?.evaluations ?? [],
        totalScore: prev?.totalScore ?? null,
        feedback: prev?.feedback ?? null,
        status: "Failed",
        error,
        aiRunAt: prev?.aiRunAt ?? null,
        editedAt: prev?.editedAt ?? null,
      },
    })
    .catch((err) => logger.warn(`[Recheck] Couldn't record the failed AI run of ${requestId}: ${err?.message || err}`));
}
