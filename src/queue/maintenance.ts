/**
 * Scheduled maintenance — the API's cron jobs, as BullMQ job schedulers on one queue.
 *
 * Every process that runs workers registers the schedules; a schedule's id is unique in the
 * queue database, so two API instances still give ONE run per tick, picked up by whichever
 * worker is free (no "every instance runs the cron" duplicates, nothing lost on restart).
 *
 *   evaluation-watchdog       5 min   Pending evaluations without a queued job are queued again;
 *                                     ones stuck for EVAL_STUCK_HOURS are failed (evaluationMaintenance.ts)
 *   evaluation-retry          15 min  transient failures re-queued once the services answer again
 *   sheet-quality-sweep       15 min  sheets never scan-checked get checked (sheetQuality.service.ts)
 *   subscription-maintenance  hourly  expiry and renewal reminders (subscriptionScheduler.ts)
 *   queue-cleanup             daily   finished jobs past their retention removed from every queue
 *   encrypt-sensitive-data    daily   plain-text values of encrypted columns encrypted, old-key ones
 *                                     re-encrypted (security/dataProtectionMaintenance.ts)
 *   password-reset-cleanup    daily   expired OTP rows deleted
 */

import logger from "../config/logger";
import { allQueues, defineQueue, defineSchedule, PermanentJobError, type Repeat } from "./index";

type Task = () => Promise<unknown>;

const DAY_SEC = 24 * 60 * 60;
const tasks = new Map<string, Task>();

export const maintenanceQueue = defineQueue<Record<string, unknown>>({
  name: "maintenance",
  concurrency: 2,
  defaults: { attempts: 2, backoff: { type: "fixed", delayMs: 60_000 }, keepCompletedSec: 2 * DAY_SEC, keepFailedSec: 14 * DAY_SEC },
  lockMs: 5 * 60_000,
  processor: async (job) => {
    const task = tasks.get(job.name);
    if (!task) throw new PermanentJobError(`No maintenance task "${job.name}" in this version of the API.`);
    const started = Date.now();
    const result = await task();
    logger.info(`[Maintenance] ${job.name} done in ${Math.round((Date.now() - started) / 1000)}s${result ? `: ${JSON.stringify(result)}` : ""}`);
    return result ?? null;
  },
});

/** A named task and when it runs. */
export function defineMaintenanceTask(name: string, repeat: Repeat, task: Task) {
  if (tasks.has(name)) throw new Error(`Maintenance task "${name}" is defined twice.`);
  tasks.set(name, task);
  defineSchedule(maintenanceQueue, name, repeat, { name });
}

/** Runs a task now, besides its schedule (e.g. right after a deploy). */
export const runMaintenanceTaskNow = (name: string) => maintenanceQueue.add(name, {}, { dedupeKey: `now-${name}`, attempts: 1 });

defineMaintenanceTask("queue-cleanup", { pattern: "30 3 * * *" }, async () => {
  const removed: Record<string, number> = {};
  for (const q of allQueues()) {
    const keep = q.definition.defaults;
    removed[q.name] = (await q.clean(keep.keepCompletedSec, "completed")) + (await q.clean(keep.keepFailedSec, "failed"));
  }
  return removed;
});
