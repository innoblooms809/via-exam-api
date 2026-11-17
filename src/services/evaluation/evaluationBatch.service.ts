/**
 * Many sheets at once — the queue page's "Evaluate all" and its single status poll.
 *
 * The same rules as one sheet at a time: only the assigned evaluator runs the AI
 * (requireSheetsAccess), published results are never re-run in place and a sheet in a
 * cross-check only by its checker (evaluationRunFor). One access lookup and one queue read
 * serve the whole batch, so 100 sheets cost a handful of queries, not hundreds.
 */

import AIEvaluation from "../../models/AIEvaluation.model";
import logger from "../../config/logger";
import { requireSheetsAccess } from "./evaluationAccess.service";
import { evaluationRunFor } from "./recheckDraft.service";
import { EvaluationLockedError, type EvaluationLockReason } from "./evaluationLock.service";
import {
  getQueueSnapshot,
  getSheetsQueueInfo,
  pauseEvaluation,
  resumeEvaluation,
  triggerPipeline6Evaluation,
  type PauseOutcome,
  type ResumeOutcome,
  type SheetQueueInfo,
} from "./pipeline6.service";
import { failureOf } from "./evaluationFailure";
import { record } from "./evaluationQueueMonitor";
import { msg, type Message } from "../../i18n/message";

export interface BatchTriggerResult {
  sheetId: string;
  queued: boolean;
  /** "Pending" once queued; the evaluation's status when it was left alone. */
  status: string | null;
  message: Message;
  queue: SheetQueueInfo | null;
  /** Not run because the sheet is locked (published, cross-checked, section completed): not a failure. */
  lock?: EvaluationLockReason;
}

/** Runs `worker` over `items`, `limit` at a time. */
const pooled = async <T>(items: T[], limit: number, worker: (item: T) => Promise<void>) => {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await worker(items[next++]);
    })
  );
};

export async function triggerBatch(user: any, sheetIds: string[], force: boolean) {
  const { allowed, refused } = await requireSheetsAccess(user, sheetIds, { evaluate: true });
  const byId = new Map<string, BatchTriggerResult>();
  for (const [sheetId, message] of refused) byId.set(sheetId, { sheetId, queued: false, status: null, message, queue: null });

  await pooled([...allowed.keys()], 4, async (sheetId) => {
    try {
      const run = await evaluationRunFor(user, sheetId);
      const r = await triggerPipeline6Evaluation(sheetId, force, run.recheck, run.crossCheck, { requestedBy: user?.userId ?? null, withQueueInfo: false });
      byId.set(sheetId, {
        sheetId,
        queued: !r.error && r.data?.status === "Pending",
        status: r.data?.status ?? null,
        message: r.message,
        queue: null,
      });
    } catch (err: any) {
      byId.set(sheetId, {
        sheetId,
        queued: false,
        status: null,
        message: err?.localized ?? err?.message ?? "This sheet can't be evaluated now.",
        queue: null,
        ...(err instanceof EvaluationLockedError ? { lock: err.lock.reason } : {}),
      });
    }
  });

  // One read of the queues for every place in line.
  const places = await getSheetsQueueInfo([...byId.keys()]).catch((err) => {
    logger.warn(`[Evaluation batch] Queue places unavailable: ${err?.message || err}`);
    return new Map<string, SheetQueueInfo>();
  });
  const results = sheetIds.map((id) => byId.get(id)!).filter(Boolean).map((r) => ({ ...r, queue: places.get(r.sheetId) ?? null }));
  return {
    results,
    counts: {
      requested: sheetIds.length,
      queued: results.filter((r) => r.queued).length,
      skipped: results.filter((r) => !r.queued).length,
    },
  };
}

export interface PauseResult {
  sheetId: string;
  /** paused: taken out of the line · continuing: it had started, so it goes on to the end. */
  outcome: PauseOutcome | "refused";
  message?: Message;
}

/**
 * "Pause": the requester's sheets that haven't started yet leave the line; the ones already in OCR
 * or the AI step go on to the end (see pipeline6.service, pause / resume). Only sheets the
 * requester may evaluate; other classes' sheets in the queue are not touched.
 */
export async function pauseBatch(user: any, sheetIds: string[]) {
  const { allowed, refused } = await requireSheetsAccess(user, sheetIds, { evaluate: true });
  const byId = new Map<string, PauseResult>();
  for (const [sheetId, message] of refused) byId.set(sheetId, { sheetId, outcome: "refused", message });
  await pooled([...allowed.keys()], 4, async (sheetId) => {
    try {
      byId.set(sheetId, { sheetId, ...(await pauseEvaluation(sheetId, user?.userId ?? null)) });
    } catch (err: any) {
      logger.warn(`[Evaluation batch] Sheet ${sheetId} could not be paused: ${err?.message || err}`);
      byId.set(sheetId, { sheetId, outcome: "refused", message: msg("This sheet couldn't be paused. Try again.") });
    }
  });
  const results = sheetIds.map((id) => byId.get(id)!).filter(Boolean);
  const count = (o: PauseResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const counts = { requested: sheetIds.length, paused: count("paused"), continuing: count("continuing"), notQueued: count("not-queued"), refused: count("refused") };
  record(
    "pause.batch",
    { by: user?.userId, ...counts },
    { msg: `Pause by ${user?.userId ?? "?"}: ${counts.paused} taken out of the line, ${counts.continuing} had started and go on to the end, ${counts.notQueued} weren't queued.` }
  );
  return { results, counts };
}

export interface ResumeResult {
  sheetId: string;
  outcome: ResumeOutcome | "refused";
  message?: Message;
  queue?: SheetQueueInfo | null;
  /** Not resumed because the sheet is locked now (results published, cross-checked, section completed). */
  lock?: EvaluationLockReason;
}

/**
 * "Resume": paused sheets go back in line, at the end. The same rules as evaluating: never on
 * published results, a sheet in a cross-check or a section marked completed (it says which), and
 * only the assigned evaluator.
 */
export async function resumeBatch(user: any, sheetIds: string[]) {
  const { allowed, refused } = await requireSheetsAccess(user, sheetIds, { evaluate: true });
  const byId = new Map<string, ResumeResult>();
  for (const [sheetId, message] of refused) byId.set(sheetId, { sheetId, outcome: "refused", message });
  await pooled([...allowed.keys()], 4, async (sheetId) => {
    try {
      const run = await evaluationRunFor(user, sheetId);
      if (run.recheck || run.crossCheck) {
        byId.set(sheetId, { sheetId, outcome: "refused", message: msg("This sheet is in a recheck or cross-check now; run it from there.") });
        return;
      }
      byId.set(sheetId, { sheetId, ...(await resumeEvaluation(sheetId, user?.userId ?? null)) });
    } catch (err: any) {
      byId.set(sheetId, {
        sheetId,
        outcome: "refused",
        message: err?.localized ?? err?.message ?? msg("This sheet can't be evaluated now."),
        ...(err instanceof EvaluationLockedError ? { lock: err.lock.reason } : {}),
      });
    }
  });
  const places = await getSheetsQueueInfo([...byId.keys()]).catch(() => new Map<string, SheetQueueInfo>());
  const results = sheetIds.map((id) => byId.get(id)!).filter(Boolean).map((r) => ({ ...r, queue: places.get(r.sheetId) ?? null }));
  const count = (o: ResumeResult["outcome"]) => results.filter((r) => r.outcome === o).length;
  const counts = { requested: sheetIds.length, queued: count("queued"), alreadyQueued: count("already-queued"), notPaused: count("not-paused"), refused: count("refused") };
  record("resume.batch", { by: user?.userId, ...counts }, { msg: `Resume by ${user?.userId ?? "?"}: ${counts.queued} back in line, ${counts.refused} refused.` });
  return { results, counts };
}

/**
 * Status of each sheet the requester may see, with its place in the queue — no answer texts —
 * and the load of both stages (how many run and wait, whether a server is down).
 *
 * The queue is the truth while a sheet's own run is in it: the sheet is Pending whatever its row
 * says (another API process may have written "Failed" over it; the heartbeat puts that right).
 */
export async function statusBatch(user: any, sheetIds: string[]) {
  const { allowed, refused } = await requireSheetsAccess(user, sheetIds);
  const rows = allowed.size
    ? await AIEvaluation.findAll({
        where: { sheetId: [...allowed.keys()] },
        attributes: ["sheetId", "evaluationId", "status", "error", "totalScore", "failureKind", "failure", "pause", "queuedAt", "startedAt", "finishedAt", "runCount", "updatedAt"],
      })
    : [];
  const rowOf = new Map(rows.map((r) => [r.sheetId, r.get({ plain: true }) as any]));
  const places = await getSheetsQueueInfo([...allowed.keys()]).catch(() => new Map<string, SheetQueueInfo>());
  const queue = await getQueueSnapshot().catch(() => null);

  return {
    sheets: sheetIds
      .filter((id) => allowed.has(id))
      .map((sheetId) => {
        const row = rowOf.get(sheetId);
        // A paused sheet is out of the line (its job was taken out before the pause was written).
        const place = row?.pause ? null : places.get(sheetId) ?? null;
        const inLine = place?.run === "evaluation";
        const status = inLine ? "Pending" : row?.status ?? "NotStarted";
        // A Failed run says why; so does an evaluated sheet whose re-run failed (its marks were kept).
        const error = status === "Failed" || (status === "Success" && row?.error) ? row?.error ?? null : null;
        // Teachers get the code and the server's words; service addresses and hosts stay in the diagnostics.
        const failure = error ? failureOf(row) : null;
        return {
          sheetId,
          status,
          evaluationId: row?.evaluationId ?? null,
          totalScore: row?.totalScore ?? null,
          error,
          failure: failure
            ? { code: failure.code, stage: failure.stage, detail: failure.detail, attempts: failure.attempts, maxAttempts: failure.maxAttempts, at: failure.at }
            : null,
          failureKind: error ? row?.failureKind ?? null : null,
          queuedAt: inLine ? new Date(place!.queuedAt).toISOString() : row?.queuedAt ?? null,
          startedAt: row?.startedAt ?? null,
          finishedAt: inLine ? null : row?.finishedAt ?? null,
          runCount: row?.runCount ?? 0,
          updatedAt: row?.updatedAt ?? null,
          queue: place,
          // Paused before OCR (nothing done yet); `rerun`: a re-evaluation, its earlier marks still show.
          pause: row?.pause ? { at: row.pause.at ?? null, rerun: Boolean(row.pause.rerun) } : null,
        };
      }),
    refused: [...refused].map(([sheetId, message]) => ({ sheetId, message })),
    queue,
  };
}

export default { triggerBatch, statusBatch, pauseBatch, resumeBatch };
