/**
 * BullMQ on PostgreSQL — the production queue driver. No Redis.
 *
 *   • One pg pool serves every queue and worker of this process (each worker also keeps one
 *     connection of it for LISTEN/NOTIFY, so it hears about new jobs at once).
 *   • BullMQ keeps its tables in their own schema (QUEUE_SCHEMA, default "bullmq"); they are
 *     created / upgraded here on start (one transaction, under an advisory lock, so several
 *     processes starting together migrate once).
 *   • Jobs are durable: a process that dies mid-job leaves it locked; when the lock lapses
 *     another worker (or the restarted one) runs it again.
 */

import {
  quoteSchemaName,
  runMigrations,
  UnrecoverableError,
  withBackend,
  createPostgresBackend,
  type Job,
  type PgModule,
  type PgPool,
} from "bullmq";
import logger from "../config/logger";
import { queueConfig } from "./config";
import {
  isPermanent,
  type AddOptions,
  type JobContext,
  type JobQueue,
  type JobState,
  type JobView,
  type QueueDefinition,
  type QueueDriver,
  type Repeat,
} from "./types";

const { Queue, Worker } = withBackend(createPostgresBackend);
type BullQueue = InstanceType<typeof Queue>;
type BullWorker = InstanceType<typeof Worker>;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms).unref?.());

/** Keep a finished job this many seconds; 0 = remove it as soon as it finishes. */
const keep = (seconds: number) => (seconds > 0 ? { age: seconds } : true);

const view = <T>(job: Job<T>, state: JobState, position = 0): JobView<T> => ({
  id: String(job.id),
  name: job.name,
  data: job.data,
  state,
  attemptsMade: job.attemptsMade ?? 0,
  maxAttempts: job.opts?.attempts ?? 1,
  createdAt: job.timestamp,
  processedAt: job.processedOn ?? null,
  finishedAt: job.finishedOn ?? null,
  failedReason: job.failedReason || null,
  progress: job.progress,
  returnValue: job.returnvalue ?? null,
  position,
});

class PostgresJobQueue<T> implements JobQueue<T> {
  constructor(private readonly def: QueueDefinition<T>, private readonly q: BullQueue) {}

  get name() {
    return this.def.name;
  }

  private options(opts: AddOptions = {}) {
    const d = this.def.defaults;
    const backoff = opts.backoff ?? d.backoff;
    return {
      jobId: opts.jobId,
      ...(opts.dedupeKey ? { deduplication: { id: opts.dedupeKey } } : {}),
      ...(opts.delayMs ? { delay: opts.delayMs } : {}),
      ...(opts.priority ? { priority: opts.priority } : {}),
      attempts: opts.attempts ?? d.attempts,
      backoff: { type: backoff.type, delay: backoff.delayMs },
      removeOnComplete: keep(opts.keepCompletedSec ?? d.keepCompletedSec),
      removeOnFail: keep(opts.keepFailedSec ?? d.keepFailedSec),
    };
  }

  async add(name: string, data: T, opts?: AddOptions): Promise<string> {
    const job = await this.q.add(name as any, data as any, this.options(opts));
    return String(job.id);
  }

  async addBulk(jobs: Array<{ name: string; data: T; opts?: AddOptions }>): Promise<string[]> {
    if (!jobs.length) return [];
    const added = await this.q.addBulk(jobs.map((j) => ({ name: j.name as any, data: j.data as any, opts: this.options(j.opts) })));
    return added.map((j) => String(j.id));
  }

  async getJob(id: string): Promise<JobView<T> | null> {
    const job = (await this.q.getJob(id)) as Job<T> | undefined;
    if (!job) return null;
    const state = (await job.getState()) as JobState;
    let position = 0;
    if (state === "waiting" || state === "prioritized") {
      const waiting = await this.q.getJobs(["waiting", "prioritized"], 0, 999, true);
      position = waiting.findIndex((j) => String(j.id) === id) + 1;
    }
    return view(job, state, position);
  }

  async liveJobs(limit = 1000): Promise<JobView<T>[]> {
    const [active, waiting, delayed] = await Promise.all([
      this.q.getJobs(["active"], 0, limit - 1, true),
      this.q.getJobs(["waiting", "prioritized"], 0, limit - 1, true),
      this.q.getJobs(["delayed", "waiting-children"], 0, limit - 1, true),
    ]);
    return [
      ...active.map((j) => view(j as Job<T>, "active")),
      ...waiting.map((j, i) => view(j as Job<T>, "waiting", i + 1)),
      ...delayed.map((j) => view(j as Job<T>, "delayed")),
    ];
  }

  async counts(): Promise<Record<string, number>> {
    return this.q.getJobCounts("active", "waiting", "prioritized", "delayed", "waiting-children", "completed", "failed");
  }

  async dedupedJobId(key: string): Promise<string | null> {
    const id = await this.q.getDeduplicationJobId(key);
    return id ? String(id) : null;
  }

  async remove(id: string): Promise<boolean> {
    return (await this.q.remove(id)) === 1;
  }

  async schedule(id: string, repeat: Repeat, job: { name: string; data?: T }): Promise<void> {
    const d = this.def.defaults;
    await this.q.upsertJobScheduler(
      id,
      { ...(repeat.pattern ? { pattern: repeat.pattern } : { every: repeat.everyMs }), ...(repeat.tz ? { tz: repeat.tz } : {}) },
      {
        name: job.name as any,
        data: (job.data ?? {}) as any,
        opts: {
          attempts: d.attempts,
          backoff: { type: d.backoff.type, delay: d.backoff.delayMs },
          removeOnComplete: keep(d.keepCompletedSec),
          removeOnFail: keep(d.keepFailedSec),
        },
      }
    );
  }

  async unschedule(id: string): Promise<void> {
    await this.q.removeJobScheduler(id);
  }

  async clean(olderThanSec: number, state: "completed" | "failed"): Promise<number> {
    const removed = await this.q.clean(olderThanSec * 1000, 1000, state);
    return removed.length;
  }

  close() {
    return this.q.close();
  }

  async applyGlobalConcurrency() {
    const q: any = this.q;
    if (this.def.globalConcurrency && typeof q.setGlobalConcurrency === "function") {
      await q.setGlobalConcurrency(this.def.globalConcurrency);
    } else if (!this.def.globalConcurrency && typeof q.removeGlobalConcurrency === "function") {
      await q.removeGlobalConcurrency();
    }
  }
}

class PostgresDriver implements QueueDriver {
  readonly kind = "postgres" as const;
  private readonly queues = new Map<string, PostgresJobQueue<any>>();
  private readonly workers: BullWorker[] = [];

  constructor(private readonly pool: PgPool) {}

  queue<T>(def: QueueDefinition<T>): JobQueue<T> {
    let q = this.queues.get(def.name);
    if (!q) {
      q = new PostgresJobQueue<T>(def, new Queue(def.name, { connection: this.pool }));
      this.queues.set(def.name, q);
    }
    return q as JobQueue<T>;
  }

  async startWorker<T>(def: QueueDefinition<T>): Promise<void> {
    if (!def.processor) return;
    const processor = def.processor;
    await (this.queue(def) as PostgresJobQueue<T>).applyGlobalConcurrency().catch((err) =>
      logger.warn(`[Queue] ${def.name}: could not set its global concurrency: ${err?.message || err}`)
    );

    const worker: BullWorker = new Worker<any>(
      def.name,
      async (job: Job<T>) => {
        const ctx: JobContext<T> = {
          id: String(job.id),
          name: job.name,
          data: job.data,
          attemptsMade: job.attemptsMade ?? 0,
          maxAttempts: job.opts?.attempts ?? 1,
          lastProgress: job.progress,
          progress: (value) => job.updateProgress(value),
          rateLimit: async (ms: number) => {
            await worker.rateLimit(Math.max(1000, ms));
            throw Worker.RateLimitError();
          },
        };
        try {
          return await processor(ctx);
        } catch (err: any) {
          // BullMQ only recognises its own class as "do not retry".
          if (isPermanent(err) && !(err instanceof UnrecoverableError)) throw new UnrecoverableError(err.message);
          throw err;
        }
      },
      {
        connection: this.pool,
        concurrency: def.concurrency,
        lockDuration: def.lockMs ?? 60_000,
        maxStalledCount: def.maxStalls ?? 1,
      }
    );

    worker.on("failed", (job, err) => {
      if (!job) return;
      logger.warn(`[Queue] ${def.name} job ${job.id} (${job.name}) attempt ${job.attemptsMade}/${job.opts?.attempts ?? 1} failed: ${err?.message || err}`);
      if (!def.onFailed) return;
      void (async () => {
        // Only once it has failed for good; an attempt that will be retried is still "delayed".
        const state = (await job.getState().catch(() => "unknown")) as JobState;
        if (state !== "failed") return;
        await def.onFailed!(view(job as Job<T>, "failed"), err);
      })().catch((e) => logger.error(`[Queue] ${def.name}: failure handler for job ${job.id} crashed: ${e?.message || e}`));
    });
    worker.on("error", (err) => logger.error(`[Queue] ${def.name} worker error: ${err?.message || err}`));
    this.workers.push(worker);
  }

  async close(graceMs: number): Promise<void> {
    // Running jobs get `graceMs` to finish; any still running keep their lock and are picked up
    // again by the next worker once it lapses.
    const stopped = Promise.all(this.workers.map((w) => w.close().catch(() => undefined)));
    await Promise.race([stopped, sleep(graceMs)]);
    await Promise.all(this.workers.map((w) => w.close(true).catch(() => undefined)));
    await Promise.all([...this.queues.values()].map((q) => q.close().catch(() => undefined)));
    await this.pool.end().catch(() => undefined);
  }

  async ping(): Promise<void> {
    await this.pool.query("SELECT 1");
  }
}

/**
 * Connects, brings BullMQ's schema up to date and returns the driver. Throws when the database
 * can't host the queue (unreachable, PostgreSQL older than 13, no right to create the schema).
 */
export async function createPostgresDriver(workerCount: number): Promise<QueueDriver> {
  // pg ships without types here; BullMQ's structural types describe the part it uses.
  const pg = require("pg") as PgModule;
  const schema = queueConfig.schema;
  const pool = new pg.Pool({
    ...queueConfig.connection,
    // Every worker holds one connection for LISTEN, on top of the ones for commands.
    max: queueConfig.poolMax + workerCount,
    // BullMQ's SQL names its tables without a schema; pin it on every connection.
    options: `-c search_path=${quoteSchemaName(schema)}`,
    application_name: "viaexam-queue",
    keepAlive: true,
    connectionTimeoutMillis: 15_000,
  });
  pool.on("error", (err) => logger.warn(`[Queue] PostgreSQL connection dropped: ${err?.message || err}`));
  // Every queue and worker of the process listens on this one pool: a fixed set, not a leak.
  (pool as unknown as { setMaxListeners?: (n: number) => void }).setMaxListeners?.(200);

  try {
    const client = await pool.connect();
    try {
      await runMigrations(client, schema);
    } finally {
      client.release();
    }
  } catch (err) {
    await pool.end().catch(() => undefined);
    throw err;
  }
  return new PostgresDriver(pool);
}
