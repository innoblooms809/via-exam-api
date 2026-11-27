/**
 * Scheduled upkeep of AI evaluation (see queue/maintenance.ts for the schedule).
 *
 *   evaluation-watchdog  A Pending evaluation must have a job in the queue. One without (queued
 *                        before this version, lost by an in-process fallback queue, or a crash
 *                        between the two stages) is failed as "interrupted", never queued again:
 *                        the teacher decides whether to run it again (each run may be billed).
 *                        One Pending for longer than EVAL_STUCK_HOURS (default 12) is failed as
 *                        "stuck". A recheck / cross-check draft whose run vanished is failed
 *                        ("run it again"), as before.
 *                        A row is left alone while its run's process keeps it fresh (heartbeat,
 *                        every 30 s): another API process may hold it in a queue this one can't
 *                        see. A run held by an earlier process on THIS machine that has since
 *                        stopped (its in-memory queue went with it) is failed at once.
 *
 * Nothing here re-runs a failed sheet: a teacher does, when they choose to.
 */

import { Op } from "sequelize";
import AIEvaluation from "../../models/AIEvaluation.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import { CrossCheckItem } from "../../models/CrossCheck.model";
import logger from "../../config/logger";
import { positiveInt } from "../../queue/config";
import { defineMaintenanceTask, retireMaintenanceTask } from "../../queue/maintenance";
import { liveRunKeys, settleFailedEvaluation } from "./pipeline6.service";
import { failRecheckAiRun } from "./recheckDraft.service";
import { failCrossCheckAiRun } from "./crossCheckDraft.service";
import { instance, record } from "./evaluationQueueMonitor";

const MINUTE = 60_000;
const STUCK_MS = positiveInt(process.env.EVAL_STUCK_HOURS, 12) * 60 * MINUTE;
// A run just queued may not have its job yet, and a live run's process refreshes its row every
// 30 s (pipeline6.service heartbeat): a row unchanged this long has nobody working on it.
const GRACE_MS = 3 * MINUTE;
const BATCH = 200;

/** Is the process with this id still running? (Signal 0 only checks; EPERM means it exists.) */
const processAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === "EPERM";
  }
};

/** A run held by an earlier API process on this machine that has stopped: nothing will finish it. */
const orphanedHere = (owner: string | null | undefined): boolean => {
  const match = /^(.*)#(\d+)$/.exec(String(owner ?? ""));
  if (!match || owner === instance.id || match[1] !== instance.host) return false;
  return !processAlive(Number(match[2]));
};

export async function evaluationWatchdog() {
  const live = await liveRunKeys();
  const now = Date.now();
  let interrupted = 0;
  let failed = 0;

  const pending = await AIEvaluation.findAll({
    where: {
      status: "Pending",
      [Op.or]: [
        { updatedAt: { [Op.lt]: new Date(now - GRACE_MS) } },
        // Held by an earlier process on this machine: checked below, without waiting for the grace.
        { runOwner: { [Op.like]: `${instance.host.replace(/[\\%_]/g, "\\$&")}#%`, [Op.ne]: instance.id } },
      ],
    } as any,
    attributes: ["sheetId", "queuedAt", "createdAt", "updatedAt", "runOwner"],
    order: [["updatedAt", "ASC"]],
    limit: BATCH,
  });
  for (const row of pending) {
    if (live.has(`sheet-${row.sheetId}`)) continue;
    const stale = new Date(row.updatedAt as any).getTime() < now - GRACE_MS;
    const orphan = orphanedHere(row.runOwner);
    // Fresh, and its owner may be alive (another machine, or a process here that still runs): leave it.
    if (!stale && !orphan) continue;
    const since = new Date(row.queuedAt ?? row.updatedAt ?? row.createdAt).getTime();
    if (now - since > STUCK_MS) {
      // A stuck re-run keeps the sheet's earlier marks, as a failed one does (settleFailedEvaluation).
      const text = `The evaluation did not finish within ${Math.round(STUCK_MS / 3600000)} hours. Run it again.`;
      await settleFailedEvaluation(row.sheetId, text, "transient", { code: "stuck", stage: null, detail: text, instance: instance.id, at: new Date().toISOString() });
      record("watchdog.stuck", { sheetId: row.sheetId, owner: row.runOwner, sinceMs: now - since }, { level: "warn", msg: `Sheet ${row.sheetId} was Pending for ${Math.round((now - since) / 3600000)} h with no job: failed as stuck.` });
      failed++;
      continue;
    }
    // Its job is gone: stop the run and let the teacher decide whether to run it again (each run
    // may be billed). A re-run keeps the sheet's earlier marks (settleFailedEvaluation).
    const text = "The evaluation was interrupted (the server restarted or its job was lost). Run it again.";
    await settleFailedEvaluation(row.sheetId, text, "transient", { code: "interrupted", stage: null, detail: text, instance: instance.id, at: new Date().toISOString() });
    interrupted++;
    record(
      "watchdog.interrupted",
      { sheetId: row.sheetId, previousOwner: row.runOwner, orphan, idleMs: now - new Date(row.updatedAt as any).getTime() },
      {
        level: "warn",
        msg: orphan
          ? `Sheet ${row.sheetId} was in the in-memory queue of an earlier process on this machine (${row.runOwner}), which stopped: marked failed (interrupted).`
          : `Sheet ${row.sheetId} was Pending with no job anywhere this process can see, and its row was idle ${Math.round((now - new Date(row.updatedAt as any).getTime()) / 60_000)} min: marked failed (interrupted).`,
      }
    );
  }

  // Draft runs (recheck, cross-check) can't be resumed for their teacher: they show as failed.
  const rechecks = await RecheckAssignment.findAll({ where: { draft: { status: "Pending" } } as any, attributes: ["requestId", "updatedAt"] });
  for (const r of rechecks) {
    if (live.has(`recheck-${r.requestId}`) || now - new Date(r.updatedAt as any).getTime() < GRACE_MS) continue;
    await failRecheckAiRun(r.requestId, "The AI run was interrupted. Run it again.");
    failed++;
  }
  const crossChecks = await CrossCheckItem.findAll({ where: { draft: { status: "Pending" } } as any, attributes: ["itemId", "updatedAt"] });
  for (const c of crossChecks) {
    if (live.has(`cross-${c.itemId}`) || now - new Date((c as any).updatedAt).getTime() < GRACE_MS) continue;
    await failCrossCheckAiRun(c.itemId, "The AI run was interrupted. Run it again.");
    failed++;
  }

  if (interrupted || failed) logger.info(`[Maintenance] Evaluation watchdog: ${interrupted} interrupted, ${failed} failed.`);
  return { checked: pending.length, interrupted, failed };
}

defineMaintenanceTask("evaluation-watchdog", { everyMs: 5 * MINUTE }, evaluationWatchdog);
// Removed: a failed sheet is run again only when a teacher asks (each run may be billed). Its
// schedule, still saved in the queue database of an earlier version, is deleted on start.
retireMaintenanceTask("evaluation-retry");
