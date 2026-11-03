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
import { getSheetsQueueInfo, triggerPipeline6Evaluation, type SheetQueueInfo } from "./pipeline6.service";

export interface BatchTriggerResult {
  sheetId: string;
  queued: boolean;
  /** "Pending" once queued; the evaluation's status when it was left alone. */
  status: string | null;
  message: string;
  queue: SheetQueueInfo | null;
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
      byId.set(sheetId, { sheetId, queued: false, status: null, message: err?.message || "This sheet can't be evaluated now.", queue: null });
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

/** Status of each sheet the requester may see, with its place in the queue — no answer texts. */
export async function statusBatch(user: any, sheetIds: string[]) {
  const { allowed, refused } = await requireSheetsAccess(user, sheetIds);
  const rows = allowed.size
    ? await AIEvaluation.findAll({
        where: { sheetId: [...allowed.keys()] },
        attributes: ["sheetId", "evaluationId", "status", "error", "totalScore", "failureKind", "queuedAt", "startedAt", "finishedAt", "runCount", "updatedAt"],
      })
    : [];
  const rowOf = new Map(rows.map((r) => [r.sheetId, r.get({ plain: true }) as any]));
  const places = await getSheetsQueueInfo([...allowed.keys()]).catch(() => new Map<string, SheetQueueInfo>());

  return {
    sheets: sheetIds
      .filter((id) => allowed.has(id))
      .map((sheetId) => {
        const row = rowOf.get(sheetId);
        return {
          sheetId,
          status: row?.status ?? "NotStarted",
          evaluationId: row?.evaluationId ?? null,
          totalScore: row?.totalScore ?? null,
          error: row?.status === "Failed" ? row.error ?? null : null,
          failureKind: row?.failureKind ?? null,
          queuedAt: row?.queuedAt ?? null,
          startedAt: row?.startedAt ?? null,
          finishedAt: row?.finishedAt ?? null,
          runCount: row?.runCount ?? 0,
          updatedAt: row?.updatedAt ?? null,
          queue: places.get(sheetId) ?? null,
        };
      }),
    refused: [...refused].map(([sheetId, message]) => ({ sheetId, message })),
  };
}

export default { triggerBatch, statusBatch };
