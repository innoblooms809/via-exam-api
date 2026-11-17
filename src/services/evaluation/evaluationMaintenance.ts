/**
 * Scheduled upkeep of AI evaluation (see queue/maintenance.ts for the schedule).
 *
 *   evaluation-watchdog  A Pending evaluation must have a job in the queue. One without (queued
 *                        before this version, lost by an in-process fallback queue, or a crash
 *                        between the two stages) is queued again; one Pending for longer than
 *                        EVAL_STUCK_HOURS (default 12) is failed so the teacher can see it and
 *                        re-run. A recheck / cross-check draft whose run vanished is failed
 *                        ("run it again"), as before.
 *                        A row is left alone while its run's process keeps it fresh (heartbeat,
 *                        every 30 s): another API process may hold it in a queue this one can't
 *                        see. A run held by an earlier process on THIS machine that has since
 *                        stopped (its in-memory queue went with it) is queued again at once,
 *                        before any other process's watchdog would take it.
 *   evaluation-retry     Runs that failed because a service was down (failureKind "transient")
 *                        are queued again once the OCR and AI servers answer, up to
 *                        EVAL_AUTO_RETRIES (default 2) extra runs per sheet. Never on published
 *                        results or sheets in a cross-check, nor on a sheet already in line.
 */

import axios from "axios";
import { Op } from "sequelize";
import AIEvaluation from "../../models/AIEvaluation.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import { CrossCheckItem } from "../../models/CrossCheck.model";
import logger from "../../config/logger";
import { pythonServices, serviceBase, serviceHeaders, serviceReachable } from "../../config/pythonServices";
import { positiveInt } from "../../queue/config";
import { defineMaintenanceTask } from "../../queue/maintenance";
import { liveRunKeys, settleFailedEvaluation, triggerPipeline6Evaluation } from "./pipeline6.service";
import { failRecheckAiRun } from "./recheckDraft.service";
import { failCrossCheckAiRun } from "./crossCheckDraft.service";
import { sheetEvaluationLock } from "./evaluationLock.service";
import { instance, record } from "./evaluationQueueMonitor";

const MINUTE = 60_000;
const STUCK_MS = positiveInt(process.env.EVAL_STUCK_HOURS, 12) * 60 * MINUTE;
const AUTO_RETRIES = Number.isFinite(Number(process.env.EVAL_AUTO_RETRIES)) ? Math.max(0, Number(process.env.EVAL_AUTO_RETRIES)) : 2;
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
  let requeued = 0;
  let failed = 0;
  let leftAlone = 0;
  // A process takes over another's sheet only if it can run it: one whose OCR / AI address doesn't
  // work would hold the sheet in a queue that never moves. (A connection is enough: a server deep in
  // a long OCR still accepts one.) Its own orphans it always takes back.
  const canRun = (await serviceReachable(pythonServices.ocrUrl())) && (await serviceReachable(pythonServices.pipeline6Url()));

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
    if (!canRun && !orphan) {
      leftAlone++;
      continue;
    }
    const result = await triggerPipeline6Evaluation(row.sheetId, true, null, null, { withQueueInfo: false });
    if (result?.error) {
      logger.warn(`[Maintenance] Sheet ${row.sheetId} could not be queued again: ${String(result.message)}`);
      continue;
    }
    requeued++;
    record(
      "watchdog.requeued",
      { sheetId: row.sheetId, previousOwner: row.runOwner, orphan, idleMs: now - new Date(row.updatedAt as any).getTime() },
      {
        level: "warn",
        msg: orphan
          ? `Sheet ${row.sheetId} was in the in-memory queue of an earlier process on this machine (${row.runOwner}), which stopped: queued again.`
          : `Sheet ${row.sheetId} was Pending with no job anywhere this process can see, and its row was idle ${Math.round((now - new Date(row.updatedAt as any).getTime()) / 60_000)} min: queued again.`,
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

  if (requeued || failed) logger.info(`[Maintenance] Evaluation watchdog: ${requeued} queued again, ${failed} failed.`);
  if (leftAlone) {
    record(
      "watchdog.left-alone",
      { count: leftAlone },
      { level: "warn", msg: `${leftAlone} idle Pending sheet(s) left for another process: this one can't reach its OCR / AI server, so it wouldn't be able to run them.` }
    );
  }
  return { checked: pending.length, requeued, failed, ...(leftAlone ? { leftAlone } : {}) };
}

/** Both Python services answer (the AI one with its model loaded). */
async function servicesUp(): Promise<boolean> {
  try {
    await Promise.all([
      axios.get(`${serviceBase.ocr()}/health`, { timeout: 5000, headers: serviceHeaders("ocr") }),
      axios.get(`${serviceBase.eval()}/ready`, { timeout: 5000, headers: serviceHeaders("eval") }),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function retryTransientFailures() {
  if (AUTO_RETRIES === 0) return { skipped: "EVAL_AUTO_RETRIES=0" };
  const due = await AIEvaluation.findAll({
    where: {
      status: "Failed",
      failureKind: "transient",
      runCount: { [Op.lte]: AUTO_RETRIES },
      [Op.or]: [{ finishedAt: { [Op.lt]: new Date(Date.now() - 10 * MINUTE) } }, { finishedAt: null }],
    } as any,
    attributes: ["sheetId"],
    order: [["finishedAt", "ASC"]],
    limit: 50,
  });
  if (!due.length) return { retried: 0 };
  if (!(await servicesUp())) return { retried: 0, waiting: due.length, reason: "services not ready" };

  const live = await liveRunKeys();
  let retried = 0;
  for (const row of due) {
    // Already in line here (its row was marked failed by another process): the heartbeat restores it.
    if (live.has(`sheet-${row.sheetId}`)) continue;
    // The same rules as a teacher's run: published results, cross-checks and completed sections are left alone.
    if (await sheetEvaluationLock(row.sheetId, { teacher: true })) {
      await AIEvaluation.update({ failureKind: "permanent" } as any, { where: { sheetId: row.sheetId, status: "Failed" } });
      continue;
    }
    const result = await triggerPipeline6Evaluation(row.sheetId, true, null, null, { withQueueInfo: false });
    if (!result?.error) {
      retried++;
      record("retry.requeued", { sheetId: row.sheetId }, { level: "debug" });
    }
  }
  if (retried) record("retry.summary", { retried }, { msg: `Automatic retry: ${retried} sheet(s) that failed while a service was down are queued again.` });
  return { retried };
}

defineMaintenanceTask("evaluation-watchdog", { everyMs: 5 * MINUTE }, evaluationWatchdog);
defineMaintenanceTask("evaluation-retry", { everyMs: 15 * MINUTE }, retryTransientFailures);
