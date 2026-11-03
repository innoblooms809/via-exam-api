/**
 * Scheduled upkeep of AI evaluation (see queue/maintenance.ts for the schedule).
 *
 *   evaluation-watchdog  A Pending evaluation must have a job in the queue. One without (queued
 *                        before this version, lost by an in-process fallback queue, or a crash
 *                        between the two stages) is queued again; one Pending for longer than
 *                        EVAL_STUCK_HOURS (default 12) is failed so the teacher can see it and
 *                        re-run. A recheck / cross-check draft whose run vanished is failed
 *                        ("run it again"), as before.
 *   evaluation-retry     Runs that failed because a service was down (failureKind "transient")
 *                        are queued again once the OCR and AI servers answer, up to
 *                        EVAL_AUTO_RETRIES (default 2) extra runs per sheet. Never on published
 *                        results or sheets in a cross-check.
 */

import axios from "axios";
import { Op } from "sequelize";
import AIEvaluation from "../../models/AIEvaluation.model";
import RecheckAssignment from "../../models/RecheckAssignment.model";
import { CrossCheckItem } from "../../models/CrossCheck.model";
import logger from "../../config/logger";
import { serviceBase, serviceHeaders } from "../../config/pythonServices";
import { positiveInt } from "../../queue/config";
import { defineMaintenanceTask } from "../../queue/maintenance";
import { liveRunKeys, triggerPipeline6Evaluation } from "./pipeline6.service";
import { failRecheckAiRun, sheetPublished } from "./recheckDraft.service";
import { failCrossCheckAiRun } from "./crossCheckDraft.service";
import { sheetHeldForCrossCheck } from "../exam/crossCheck.service";

const MINUTE = 60_000;
const STUCK_MS = positiveInt(process.env.EVAL_STUCK_HOURS, 12) * 60 * MINUTE;
const AUTO_RETRIES = Number.isFinite(Number(process.env.EVAL_AUTO_RETRIES)) ? Math.max(0, Number(process.env.EVAL_AUTO_RETRIES)) : 2;
// A run just queued may not have its job yet; leave it alone this long.
const GRACE_MS = 3 * MINUTE;
const BATCH = 200;

export async function evaluationWatchdog() {
  const live = await liveRunKeys();
  const now = Date.now();
  let requeued = 0;
  let failed = 0;

  const pending = await AIEvaluation.findAll({
    where: { status: "Pending", updatedAt: { [Op.lt]: new Date(now - GRACE_MS) } },
    attributes: ["sheetId", "queuedAt", "createdAt", "updatedAt"],
    order: [["updatedAt", "ASC"]],
    limit: BATCH,
  });
  for (const row of pending) {
    if (live.has(`sheet-${row.sheetId}`)) continue;
    const since = new Date(row.queuedAt ?? row.updatedAt ?? row.createdAt).getTime();
    if (now - since > STUCK_MS) {
      await AIEvaluation.update(
        {
          status: "Failed",
          error: `The evaluation did not finish within ${Math.round(STUCK_MS / 3600000)} hours. Run it again.`,
          failureKind: "transient",
          finishedAt: new Date(),
        } as any,
        { where: { sheetId: row.sheetId, status: "Pending" } }
      );
      failed++;
      continue;
    }
    const result = await triggerPipeline6Evaluation(row.sheetId, true, null, null, { withQueueInfo: false });
    if (result?.error) logger.warn(`[Maintenance] Sheet ${row.sheetId} could not be queued again: ${result.message}`);
    else requeued++;
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
  return { checked: pending.length, requeued, failed };
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

  let retried = 0;
  for (const row of due) {
    // The same rules as a teacher's run: published results and cross-checks are left alone.
    if ((await sheetPublished(row.sheetId)) || (await sheetHeldForCrossCheck(row.sheetId))) {
      await AIEvaluation.update({ failureKind: "permanent" } as any, { where: { sheetId: row.sheetId, status: "Failed" } });
      continue;
    }
    const result = await triggerPipeline6Evaluation(row.sheetId, true, null, null, { withQueueInfo: false });
    if (!result?.error) retried++;
  }
  if (retried) logger.info(`[Maintenance] Re-queued ${retried} evaluation(s) that failed while a service was down.`);
  return { retried };
}

defineMaintenanceTask("evaluation-watchdog", { everyMs: 5 * MINUTE }, evaluationWatchdog);
defineMaintenanceTask("evaluation-retry", { everyMs: 15 * MINUTE }, retryTransientFailures);
