/**
 * In-process queues with the same behaviour as the PostgreSQL driver: concurrency, attempts
 * with backoff, permanent errors, rate limiting, deduplication, delayed jobs and repeating
 * schedules. Used by tests and as a fallback when the PostgreSQL queue can't start. Jobs live
 * in memory: a restart drops them (the evaluation watchdog then queues those sheets again).
 */

import { CronExpressionParser } from "cron-parser";
import logger from "../config/logger";
import {
  backoffDelay,
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

interface MemJob {
  id: string;
  name: string;
  data: any;
  state: JobState;
  attemptsMade: number;
  maxAttempts: number;
  backoff: { type: "fixed" | "exponential"; delayMs: number };
  priority: number;
  createdAt: number;
  processedAt: number | null;
  finishedAt: number | null;
  failedReason: string | null;
  progress: unknown;
  returnValue: unknown;
  dedupeKey?: string;
  keepCompletedSec: number;
  keepFailedSec: number;
}

const RATE_LIMITED = Symbol("rate-limited");

const later = (ms: number, fn: () => void) => {
  const t = setTimeout(fn, Math.max(0, ms));
  t.unref?.();
  return t;
};

class MemoryQueue<T> implements JobQueue<T> {
  private readonly jobs = new Map<string, MemJob>();
  private waiting: string[] = [];
  private readonly dedupe = new Map<string, string>();
  private readonly schedules = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();
  private pausedUntil = 0;
  private seq = 0;
  private processing = false;

  constructor(private def: QueueDefinition<T>) {}

  get name() {
    return this.def.name;
  }

  startProcessing(def: QueueDefinition<T>) {
    this.def = def;
    this.processing = true;
    this.pump();
  }

  stopProcessing() {
    this.processing = false;
    for (const t of this.schedules.values()) clearTimeout(t);
    this.schedules.clear();
  }

  private limit() {
    return Math.max(1, Math.min(this.def.concurrency, this.def.globalConcurrency ?? Infinity));
  }

  private pump() {
    if (!this.processing || !this.def.processor) return;
    const wait = this.pausedUntil - Date.now();
    if (wait > 0) {
      later(wait, () => this.pump());
      return;
    }
    while (this.running.size < this.limit() && this.waiting.length) {
      const job = this.jobs.get(this.waiting.shift()!);
      if (job && job.state === "waiting") void this.run(job);
    }
  }

  private toWaiting(job: MemJob, front = false) {
    job.state = "waiting";
    if (front) this.waiting.unshift(job.id);
    else if (job.priority) {
      // Jobs without a priority run first; prioritized ones by priority, then age.
      const at = this.waiting.findIndex((id) => {
        const other = this.jobs.get(id);
        return !!other && other.priority > job.priority;
      });
      if (at === -1) this.waiting.push(job.id);
      else this.waiting.splice(at, 0, job.id);
    } else {
      const firstPrioritized = this.waiting.findIndex((id) => (this.jobs.get(id)?.priority ?? 0) > 0);
      if (firstPrioritized === -1) this.waiting.push(job.id);
      else this.waiting.splice(firstPrioritized, 0, job.id);
    }
    this.pump();
  }

  private finish(job: MemJob, state: "completed" | "failed") {
    job.state = state;
    job.finishedAt = Date.now();
    if (job.dedupeKey && this.dedupe.get(job.dedupeKey) === job.id) this.dedupe.delete(job.dedupeKey);
    later((state === "completed" ? job.keepCompletedSec : job.keepFailedSec) * 1000, () => {
      if (this.jobs.get(job.id) === job && job.state === state) this.jobs.delete(job.id);
    });
  }

  private async run(job: MemJob) {
    this.running.add(job.id);
    job.state = "active";
    job.processedAt = Date.now();
    const ctx: JobContext<T> = {
      id: job.id,
      name: job.name,
      data: job.data,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.maxAttempts,
      lastProgress: job.progress,
      progress: async (value) => {
        job.progress = value;
      },
      rateLimit: async (ms: number) => {
        this.pausedUntil = Math.max(this.pausedUntil, Date.now() + Math.max(1000, ms));
        throw RATE_LIMITED;
      },
    };
    try {
      job.returnValue = await this.def.processor!(ctx);
      this.finish(job, "completed");
    } catch (err: any) {
      if (err === RATE_LIMITED) {
        this.running.delete(job.id);
        this.toWaiting(job, true);
        return;
      }
      job.attemptsMade += 1;
      job.failedReason = String(err?.message || err);
      logger.warn(`[Queue] ${this.def.name} job ${job.id} (${job.name}) attempt ${job.attemptsMade}/${job.maxAttempts} failed: ${job.failedReason}`);
      if (!isPermanent(err) && job.attemptsMade < job.maxAttempts) {
        job.state = "delayed";
        later(backoffDelay(job.backoff, job.attemptsMade), () => job.state === "delayed" && this.toWaiting(job));
      } else {
        this.finish(job, "failed");
        if (this.def.onFailed) {
          Promise.resolve(this.def.onFailed(this.view(job), err instanceof Error ? err : new Error(String(err)))).catch((e) =>
            logger.error(`[Queue] ${this.def.name}: failure handler for job ${job.id} crashed: ${e?.message || e}`)
          );
        }
      }
    } finally {
      this.running.delete(job.id);
      this.pump();
    }
  }

  private view(job: MemJob): JobView<T> {
    const position = job.state === "waiting" ? this.waiting.indexOf(job.id) + 1 : 0;
    const { id, name, data, state, attemptsMade, maxAttempts, createdAt, processedAt, finishedAt, failedReason, progress, returnValue } = job;
    return { id, name, data, state, attemptsMade, maxAttempts, createdAt, processedAt, finishedAt, failedReason, progress, returnValue, position };
  }

  async add(name: string, data: T, opts: AddOptions = {}): Promise<string> {
    if (opts.jobId && this.jobs.has(opts.jobId)) return opts.jobId;
    if (opts.dedupeKey) {
      const holder = this.dedupe.get(opts.dedupeKey);
      if (holder && this.jobs.has(holder)) return holder;
    }
    const d = this.def.defaults;
    const job: MemJob = {
      id: opts.jobId ?? String(++this.seq),
      name,
      data,
      state: "waiting",
      attemptsMade: 0,
      maxAttempts: opts.attempts ?? d.attempts,
      backoff: opts.backoff ?? d.backoff,
      priority: opts.priority ?? 0,
      createdAt: Date.now(),
      processedAt: null,
      finishedAt: null,
      failedReason: null,
      progress: 0,
      returnValue: null,
      dedupeKey: opts.dedupeKey,
      keepCompletedSec: opts.keepCompletedSec ?? d.keepCompletedSec,
      keepFailedSec: opts.keepFailedSec ?? d.keepFailedSec,
    };
    this.jobs.set(job.id, job);
    if (opts.dedupeKey) this.dedupe.set(opts.dedupeKey, job.id);
    if (opts.delayMs && opts.delayMs > 0) {
      job.state = "delayed";
      later(opts.delayMs, () => job.state === "delayed" && this.toWaiting(job));
    } else {
      this.toWaiting(job);
    }
    return job.id;
  }

  async addBulk(jobs: Array<{ name: string; data: T; opts?: AddOptions }>): Promise<string[]> {
    const ids: string[] = [];
    for (const j of jobs) ids.push(await this.add(j.name, j.data, j.opts));
    return ids;
  }

  async getJob(id: string): Promise<JobView<T> | null> {
    const job = this.jobs.get(id);
    return job ? this.view(job) : null;
  }

  async liveJobs(limit = 1000): Promise<JobView<T>[]> {
    const all = [...this.jobs.values()];
    const active = all.filter((j) => j.state === "active");
    const waiting = this.waiting.map((id) => this.jobs.get(id)).filter((j): j is MemJob => !!j && j.state === "waiting");
    const delayed = all.filter((j) => j.state === "delayed");
    return [...active, ...waiting, ...delayed].slice(0, limit).map((j) => this.view(j));
  }

  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = { active: 0, waiting: 0, prioritized: 0, delayed: 0, "waiting-children": 0, completed: 0, failed: 0 };
    for (const j of this.jobs.values()) out[j.state] = (out[j.state] ?? 0) + 1;
    return out;
  }

  async dedupedJobId(key: string): Promise<string | null> {
    const id = this.dedupe.get(key);
    return id && this.jobs.has(id) ? id : null;
  }

  async remove(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job || job.state === "active") return false;
    this.waiting = this.waiting.filter((w) => w !== id);
    if (job.dedupeKey && this.dedupe.get(job.dedupeKey) === id) this.dedupe.delete(job.dedupeKey);
    this.jobs.delete(id);
    return true;
  }

  async schedule(id: string, repeat: Repeat, job: { name: string; data?: T }): Promise<void> {
    await this.unschedule(id);
    const next = (): number => {
      if (repeat.everyMs) return repeat.everyMs;
      const at = CronExpressionParser.parse(repeat.pattern!, repeat.tz ? { tz: repeat.tz } : {}).next().getTime();
      return Math.max(1000, at - Date.now());
    };
    const tick = () => {
      this.schedules.set(
        id,
        later(next(), () => {
          void this.add(job.name, (job.data ?? {}) as T, { dedupeKey: `schedule-${id}` });
          tick();
        })
      );
    };
    tick();
  }

  async unschedule(id: string): Promise<void> {
    const t = this.schedules.get(id);
    if (t) clearTimeout(t);
    this.schedules.delete(id);
  }

  async clean(olderThanSec: number, state: "completed" | "failed"): Promise<number> {
    const cutoff = Date.now() - olderThanSec * 1000;
    let removed = 0;
    for (const [id, job] of this.jobs) {
      if (job.state === state && (job.finishedAt ?? 0) < cutoff) {
        this.jobs.delete(id);
        removed++;
      }
    }
    return removed;
  }

  idle() {
    return this.running.size === 0;
  }
}

class MemoryDriver implements QueueDriver {
  readonly kind = "memory" as const;
  private readonly queues = new Map<string, MemoryQueue<any>>();

  queue<T>(def: QueueDefinition<T>): JobQueue<T> {
    let q = this.queues.get(def.name);
    if (!q) {
      q = new MemoryQueue<T>(def);
      this.queues.set(def.name, q);
    }
    return q as JobQueue<T>;
  }

  async startWorker<T>(def: QueueDefinition<T>): Promise<void> {
    if (!def.processor) return;
    (this.queue(def) as MemoryQueue<T>).startProcessing(def);
  }

  async close(graceMs: number): Promise<void> {
    const queues = [...this.queues.values()];
    queues.forEach((q) => q.stopProcessing());
    const deadline = Date.now() + graceMs;
    while (Date.now() < deadline && !queues.every((q) => q.idle())) {
      await new Promise((resolve) => later(100, () => resolve(undefined)));
    }
  }

  async ping(): Promise<void> {
    /* always reachable */
  }
}

export const createMemoryDriver = (): QueueDriver => new MemoryDriver();
