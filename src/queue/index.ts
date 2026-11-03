/**
 * Job queues of the API — BullMQ on the app's PostgreSQL (settings: ./config).
 *
 *   defineQueue(...)      at module load: a queue's name, concurrency, retries and processor
 *   defineSchedule(...)   at module load: a repeating job (cron / interval) on a queue
 *   initQueues()          on start: connects the driver (or falls back to in-process queues)
 *   startQueueWorkers()   once the database is ready: runs processors and schedules
 *                         (skipped with QUEUE_WORKERS=false; `npm run worker` runs them instead)
 *   closeQueues()         on shutdown
 *
 * Handles returned by defineQueue can be used right away: until initQueues() has finished,
 * calls wait for it. A process that never calls it (a one-off script) gets in-process queues
 * that run their jobs in that process.
 */

import logger from "../config/logger";
import { queueConfig, type QueueDriverKind } from "./config";
import { createMemoryDriver } from "./memoryDriver";
import { createPostgresDriver } from "./postgresDriver";
import type { AddOptions, JobQueue, JobView, QueueDefinition, QueueDriver, Repeat } from "./types";

export * from "./types";

const definitions = new Map<string, QueueDefinition<any>>();
const schedules: Array<{ queue: string; id: string; repeat: Repeat; job: { name: string; data?: unknown } }> = [];

let driver: QueueDriver | null = null;
let initializing: Promise<QueueDriver> | null = null;
let workersRunning = false;
let fallbackReason: string | null = null;

export interface QueueHandle<T> extends JobQueue<T> {
  readonly definition: QueueDefinition<T>;
}

const ready = async (): Promise<QueueDriver> => {
  if (driver) return driver;
  if (initializing) return initializing;
  // Not started by the API or the worker: run jobs here (scripts, tests).
  logger.warn("[Queue] Queues used before initQueues(); running their jobs in this process.");
  await initQueues({ driver: "memory" });
  await startQueueWorkers();
  return driver!;
};

class Handle<T> implements QueueHandle<T> {
  constructor(readonly definition: QueueDefinition<T>) {}
  get name() {
    return this.definition.name;
  }
  private async q(): Promise<JobQueue<T>> {
    return (await ready()).queue(this.definition);
  }
  async add(name: string, data: T, opts?: AddOptions) {
    return (await this.q()).add(name, data, opts);
  }
  async addBulk(jobs: Array<{ name: string; data: T; opts?: AddOptions }>) {
    return (await this.q()).addBulk(jobs);
  }
  async getJob(id: string) {
    return (await this.q()).getJob(id);
  }
  async liveJobs(limit?: number): Promise<JobView<T>[]> {
    return (await this.q()).liveJobs(limit);
  }
  async counts() {
    return (await this.q()).counts();
  }
  async dedupedJobId(key: string) {
    return (await this.q()).dedupedJobId(key);
  }
  async remove(id: string) {
    return (await this.q()).remove(id);
  }
  async schedule(id: string, repeat: Repeat, job: { name: string; data?: T }) {
    return (await this.q()).schedule(id, repeat, job);
  }
  async unschedule(id: string) {
    return (await this.q()).unschedule(id);
  }
  async clean(olderThanSec: number, state: "completed" | "failed") {
    return (await this.q()).clean(olderThanSec, state);
  }
}

const handles: QueueHandle<any>[] = [];

export function defineQueue<T>(def: QueueDefinition<T>): QueueHandle<T> {
  if (definitions.has(def.name)) throw new Error(`Queue "${def.name}" is defined twice.`);
  definitions.set(def.name, def);
  const handle = new Handle<T>(def);
  handles.push(handle);
  return handle;
}

/** Every defined queue (maintenance cleans them all). */
export const allQueues = (): QueueHandle<any>[] => [...handles];

/** A repeating job, set up by every process that runs workers (the same id is never duplicated). */
export function defineSchedule<T>(queue: QueueHandle<T>, id: string, repeat: Repeat, job: { name: string; data?: T }) {
  schedules.push({ queue: queue.name, id, repeat, job });
}

const describe = (err: any) => String(err?.message || err).slice(0, 300);

/**
 * Connects the queue driver. Never throws when falling back is allowed (QUEUE_FALLBACK); a
 * worker process passes `allowFallback: false`, since in-process queues there would see none
 * of the API's jobs.
 */
export async function initQueues(options: { driver?: QueueDriverKind; allowFallback?: boolean; workers?: boolean } = {}): Promise<QueueDriverKind> {
  if (driver) return driver.kind;
  if (!initializing) {
    initializing = (async () => {
      const kind = options.driver ?? queueConfig.driver;
      if (kind === "postgres") {
        const withProcessors = [...definitions.values()].filter((d) => d.processor).length;
        try {
          driver = await createPostgresDriver((options.workers ?? queueConfig.runWorkers) ? withProcessors : 0);
          logger.info(`[Queue] BullMQ on PostgreSQL (schema "${queueConfig.schema}") ready: ${definitions.size} queues.`);
          return driver;
        } catch (err) {
          if (!(options.allowFallback ?? queueConfig.fallbackToMemory)) throw err;
          fallbackReason = describe(err);
          logger.error(
            `[Queue] The PostgreSQL queue could not start (${fallbackReason}). Falling back to in-process queues: ` +
              "jobs run in this process and are lost on restart. Fix the queue database (it needs PostgreSQL 13+ and " +
              `the right to create schema "${queueConfig.schema}") and restart.`
          );
        }
      }
      driver = createMemoryDriver();
      if (kind === "memory") logger.info(`[Queue] In-process queues (QUEUE_DRIVER=memory): ${definitions.size} queues.`);
      return driver;
    })();
    initializing.catch(() => {
      initializing = null;
    });
  }
  return (await initializing).kind;
}

/**
 * Runs the processors and schedules of every defined queue in this process. In-process queues
 * always run here (no other process can see their jobs), whatever QUEUE_WORKERS says.
 */
export async function startQueueWorkers(options: { force?: boolean } = {}): Promise<void> {
  const d = driver ?? (await ready());
  if (workersRunning) return;
  if (!options.force && !queueConfig.runWorkers && d.kind !== "memory") {
    logger.info("[Queue] QUEUE_WORKERS=false: this process adds jobs; a worker process runs them.");
    return;
  }
  workersRunning = true;
  for (const def of definitions.values()) {
    if (def.processor) await d.startWorker(def);
  }
  for (const s of schedules) {
    const def = definitions.get(s.queue);
    if (!def) continue;
    await d
      .queue(def)
      .schedule(s.id, s.repeat, s.job as any)
      .catch((err) => logger.error(`[Queue] Schedule ${s.id} on ${s.queue} could not be set: ${describe(err)}`));
  }
  logger.info(
    `[Queue] Workers running: ${[...definitions.values()].filter((x) => x.processor).map((x) => `${x.name}×${x.concurrency}`).join(", ")}` +
      (schedules.length ? `; ${schedules.length} schedules.` : ".")
  );
}

export async function closeQueues(): Promise<void> {
  const d = driver;
  if (!d) return;
  driver = null;
  initializing = null;
  workersRunning = false;
  await d.close(queueConfig.shutdownGraceMs).catch((err) => logger.warn(`[Queue] Close: ${describe(err)}`));
}

/** For /health and the queue page: the driver, whether this process runs jobs, and (optionally) counts per queue. */
export async function queueStatus(options: { counts?: boolean } = {}): Promise<{
  driver: QueueDriverKind | "none";
  workers: boolean;
  fallback: string | null;
  ok: boolean;
  queues: Record<string, Record<string, number>>;
}> {
  const d = driver;
  if (!d) return { driver: "none", workers: false, fallback: fallbackReason, ok: false, queues: {} };
  const queues: Record<string, Record<string, number>> = {};
  let ok = true;
  try {
    await d.ping();
    if (options.counts) for (const def of definitions.values()) queues[def.name] = await d.queue(def).counts();
  } catch (err) {
    ok = false;
    logger.warn(`[Queue] Status check failed: ${describe(err)}`);
  }
  return { driver: d.kind, workers: workersRunning, fallback: fallbackReason, ok, queues };
}

export const queueDriverKind = (): QueueDriverKind | "none" => driver?.kind ?? "none";
