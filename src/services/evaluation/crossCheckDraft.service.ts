/**
 * A cross-checker re-evaluates a sheet on the normal evaluation screen, as a recheck teacher does.
 *
 * Until the checker's verdict the evaluator's marks stay live. The checker may run the AI again
 * and change the question-wise marks, but all of it lands in a draft on their cross-check item
 * (CrossCheckItem.draft). Their verdict (crossCheck.service checkItem) then either keeps the
 * evaluator's marks or copies the draft into the evaluation, logged question by question.
 */

import httpStatus from "http-status";
import { Op } from "sequelize";
import AIEvaluation from "../../models/AIEvaluation.model";
import Exam from "../../models/Exam.model";
import Scanner from "../../models/Scanner.model";
import { CROSS_CHECK_ITEM_STATUS, CrossCheckItem, CrossCheckRound } from "../../models/CrossCheck.model";
import type { RecheckDraft } from "../../models/RecheckAssignment.model";
import ApiError from "../../utils/ApiError";
import logger from "../../config/logger";
import { questionChanges, totalOf } from "../../utils/questionMarks";
import { reasonTextOf } from "../exam/crossCheck.service";
import { isTeacherRequester } from "./evaluationAccess.service";

export interface CrossCheckContext {
  item: CrossCheckItem;
  round: CrossCheckRound;
  evaluation: AIEvaluation;
  /** The checker may still change it (round open, verdict not given). */
  editable: boolean;
}

/** This teacher's cross-check of the sheet, in a round they hold. Null for anyone else and any other sheet. */
export async function crossCheckFor(user: any, sheetId: string): Promise<CrossCheckContext | null> {
  if (!isTeacherRequester(user) || !sheetId) return null;
  const rounds = await CrossCheckRound.findAll({ where: { checkerId: user.userId, isActive: true }, attributes: ["roundId"] });
  if (!rounds.length) return null;
  const item = await CrossCheckItem.findOne({ where: { sheetId, roundId: { [Op.in]: rounds.map((r) => r.roundId) } }, order: [["id", "DESC"]] });
  if (!item) return null;
  const [round, evaluation] = await Promise.all([CrossCheckRound.findOne({ where: { roundId: item.roundId } }), AIEvaluation.findOne({ where: { sheetId } })]);
  if (!round || !evaluation) return null;
  return { item, round, evaluation, editable: round.status === "open" && item.status === CROSS_CHECK_ITEM_STATUS.PENDING };
}

/** The checker's draft, when they have re-evaluated (or the AI is at it). */
export const crossCheckDraftOf = (item: CrossCheckItem): RecheckDraft | null => {
  const d = item.draft;
  return d && (d.evaluations?.length || d.status === "Pending") ? d : null;
};

/**
 * What the cross-checker's evaluation screen shows: their draft over the evaluator's marks,
 * and the cross-check itself (why the sheet was chosen, the evaluator's marks, what changes).
 */
export function crossCheckView(plain: any, ctx: CrossCheckContext) {
  const { item, round, evaluation } = ctx;
  const draft = ctx.editable ? crossCheckDraftOf(item) : null;
  const evaluations = draft?.evaluations?.length ? draft.evaluations : plain.evaluations;
  const live = evaluation.totalScore == null ? null : Number(evaluation.totalScore);
  // After the verdict the evaluation holds the checker's marks; the item keeps what changed.
  const changes = ctx.editable ? questionChanges(evaluation.evaluations, evaluations) : (item.changes ?? []);
  return {
    ...plain,
    evaluations,
    totalScore: draft?.totalScore ?? live,
    feedback: draft?.feedback ?? plain.feedback,
    status: draft?.status === "Pending" ? "Pending" : plain.status,
    error: draft?.status === "Failed" ? (draft.error ?? "The AI couldn't re-evaluate this sheet.") : plain.error,
    canEvaluate: ctx.editable,
    crossCheck: {
      itemId: item.itemId,
      roundId: round.roundId,
      status: item.status,
      editable: ctx.editable,
      reasonText: reasonTextOf(item, round),
      evaluatorScore: item.marksBefore ?? live,
      draftScore: draft?.totalScore ?? null,
      aiStatus: draft?.status ?? null,
      aiRunAt: draft?.aiRunAt ?? null,
      editedAt: draft?.editedAt ?? null,
      changes,
      verdict: item.checkedAt ? { marks: item.marksAfter, note: item.note, checkedAt: item.checkedAt } : null,
    },
  };
}

export const assertCrossCheckEditable = (ctx: CrossCheckContext) => {
  if (!ctx.editable) {
    throw new ApiError(
      httpStatus.CONFLICT,
      ctx.item.status === CROSS_CHECK_ITEM_STATUS.PENDING ? "This cross-check is closed." : "You have already given your verdict on this answer sheet."
    );
  }
};

/** The cross-checker saves question-wise marks: into their draft, never the live evaluation. */
export async function saveCrossCheckDraft(ctx: CrossCheckContext, data: { evaluations?: any; totalScore?: unknown; feedback?: string }) {
  assertCrossCheckEditable(ctx);
  const prev = ctx.item.draft;
  if (prev?.status === "Pending") throw new ApiError(httpStatus.CONFLICT, "The AI is re-evaluating this sheet. Wait for it to finish, then change the marks.");
  const evaluations = Array.isArray(data.evaluations) ? data.evaluations : (prev?.evaluations ?? ctx.evaluation.evaluations ?? []);
  const sheet = await Scanner.findOne({ where: { sheetId: ctx.evaluation.sheetId }, attributes: ["examId"] });
  const exam = await Exam.findOne({ where: { examId: sheet?.examId || ctx.item.examId }, attributes: ["totalMarks"] });
  const given = data.totalScore === undefined || data.totalScore === null || data.totalScore === "" ? null : Number(data.totalScore);
  const total = given ?? totalOf(evaluations);
  if (total != null && (!Number.isFinite(total) || total < 0 || (exam && total > exam.totalMarks))) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Marks must be between 0 and ${exam?.totalMarks ?? "the paper's maximum"}.`);
  }
  const draft: RecheckDraft = {
    evaluations,
    totalScore: total == null ? null : Math.round(total * 100) / 100,
    feedback: data.feedback !== undefined ? data.feedback : (prev?.feedback ?? ctx.evaluation.feedback ?? null),
    status: "Ready",
    error: null,
    aiRunAt: prev?.aiRunAt ?? null,
    editedAt: new Date().toISOString(),
  };
  await ctx.item.update({ draft });
  ctx.item.draft = draft;
  return draft;
}

/** An AI re-run for the cross-check starts: the draft waits for it (the live evaluation is untouched). */
export async function startCrossCheckAiRun(ctx: CrossCheckContext) {
  assertCrossCheckEditable(ctx);
  const prev = ctx.item.draft;
  await ctx.item.update({
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

/** The AI's re-evaluation of a cross-check sheet: into the draft. */
export async function finishCrossCheckAiRun(itemId: string, result: { evaluations: any[]; totalScore: number | null; feedback: string | null }) {
  const item = await CrossCheckItem.findOne({ where: { itemId } });
  if (!item) return;
  await item.update({ draft: { ...result, status: "Ready", error: null, aiRunAt: new Date().toISOString(), editedAt: null } });
}

/** The AI re-run failed: the draft keeps the marks it had. */
export async function failCrossCheckAiRun(itemId: string, error: string) {
  const item = await CrossCheckItem.findOne({ where: { itemId } });
  if (!item) return;
  const prev = item.draft;
  await item
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
    .catch((err) => logger.warn(`[CrossCheck] Couldn't record the failed AI run of ${itemId}: ${err?.message || err}`));
}

/** A server restart cuts off a cross-check AI run: it shows as failed, to run again. */
export async function failInterruptedCrossCheckRuns() {
  const items = await CrossCheckItem.findAll({ where: { draft: { status: "Pending" } } as any, attributes: ["itemId"] });
  for (const i of items) await failCrossCheckAiRun(i.itemId, "The AI run was interrupted by a server restart. Run it again.");
}
