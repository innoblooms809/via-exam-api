/**
 * The job-queue contract the rest of the API uses. Two drivers implement it:
 *
 *   • postgresDriver — BullMQ on PostgreSQL: durable, shared by every API / worker process.
 *   • memoryDriver   — the same behaviour in one process (tests, fallback); lost on restart.
 *
 * Services never touch BullMQ directly, so the driver can change without touching them.
 */

export type JobState =
  | "waiting"
  | "prioritized"
  | "active"
  | "delayed"
  | "waiting-children"
  | "completed"
  | "failed"
  | "unknown";

export const LIVE_STATES: JobState[] = ["active", "waiting", "prioritized", "delayed", "waiting-children"];

export interface Backoff {
  type: "fixed" | "exponential";
  delayMs: number;
}

export interface AddOptions {
  /** Unique id. While a job with this id exists (in any state), adding it again is a no-op. No ":" allowed. */
  jobId?: string;
  /** While a live (not finished) job holds this key, adding another job with it returns that job's id instead. */
  dedupeKey?: string;
  delayMs?: number;
  attempts?: number;
  backoff?: Backoff;
  /** 1 = first. Only orders jobs that have a priority. */
  priority?: number;
  /** Finished jobs are kept this long for status pages, then removed. */
  keepCompletedSec?: number;
  keepFailedSec?: number;
}

export interface JobView<T = any> {
  id: string;
  name: string;
  data: T;
  state: JobState;
  attemptsMade: number;
  maxAttempts: number;
  createdAt: number;
  processedAt: number | null;
  finishedAt: number | null;
  failedReason: string | null;
  progress: unknown;
  returnValue: unknown;
  /** 1-based place among the waiting jobs of its queue; 0 when it is not waiting. */
  position: number;
}

export interface JobContext<T = any> {
  readonly id: string;
  readonly name: string;
  readonly data: T;
  /** Attempts already made before this one. */
  readonly attemptsMade: number;
  readonly maxAttempts: number;
  /** What an earlier attempt last reported with progress() (0 when nothing), e.g. a step it finished. */
  readonly lastProgress: unknown;
  progress(value: number | Record<string, unknown>): Promise<void>;
  /**
   * The service this job calls is busy: pause the whole queue for `ms` and put the job back
   * in line without using one of its attempts. Never returns.
   */
  rateLimit(ms: number): Promise<never>;
}

export type JobProcessor<T = any> = (job: JobContext<T>) => Promise<unknown>;

export interface QueueDefaults {
  attempts: number;
  backoff: Backoff;
  keepCompletedSec: number;
  keepFailedSec: number;
}

export interface QueueDefinition<T = any> {
  name: string;
  /** Jobs one process runs at the same time. */
  concurrency: number;
  /** Jobs running at the same time across every process (e.g. one GPU behind the AI server). */
  globalConcurrency?: number;
  defaults: QueueDefaults;
  /** How long a running job's lock lasts between renewals; a dead process's job is retried after it. */
  lockMs?: number;
  /** How many times a job may be found abandoned (its process died) before it fails. */
  maxStalls?: number;
  processor?: JobProcessor<T>;
  /** Called once a job has failed for good: its last attempt failed, or the error was permanent. */
  onFailed?: (job: JobView<T>, err: Error) => Promise<void> | void;
}

export interface Repeat {
  /** Cron pattern, e.g. "30 3 * * *". */
  pattern?: string;
  everyMs?: number;
  tz?: string;
}

export interface JobQueue<T = any> {
  readonly name: string;
  /** Adds a job; resolves to its id (the existing job's id when it was deduplicated). */
  add(name: string, data: T, opts?: AddOptions): Promise<string>;
  addBulk(jobs: Array<{ name: string; data: T; opts?: AddOptions }>): Promise<string[]>;
  getJob(id: string): Promise<JobView<T> | null>;
  /** Unfinished jobs: running first, then waiting in the order they will run (with `position`), then delayed. */
  liveJobs(limit?: number): Promise<JobView<T>[]>;
  counts(): Promise<Record<string, number>>;
  /** Id of the live job holding this dedupe key, if any. */
  dedupedJobId(key: string): Promise<string | null>;
  remove(id: string): Promise<boolean>;
  /** A repeating job (cron or interval). Same id = updated in place, never duplicated. */
  schedule(id: string, repeat: Repeat, job: { name: string; data?: T }): Promise<void>;
  unschedule(id: string): Promise<void>;
  /** Removes finished jobs older than `olderThanSec`; returns how many. */
  clean(olderThanSec: number, state: "completed" | "failed"): Promise<number>;
}

export interface QueueDriver {
  readonly kind: "postgres" | "memory";
  queue<T>(def: QueueDefinition<T>): JobQueue<T>;
  startWorker<T>(def: QueueDefinition<T>): Promise<void>;
  /** Stops workers (waiting up to `graceMs` for running jobs), then closes connections. */
  close(graceMs: number): Promise<void>;
  ping(): Promise<void>;
}

/** Thrown by a processor when retrying can't help (bad input, missing record). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

export const isPermanent = (err: unknown): boolean => {
  const name = (err as any)?.name;
  return err instanceof PermanentJobError || name === "PermanentJobError" || name === "UnrecoverableError";
};

/** Delay before retry number `attempt` (1-based) with this backoff. */
export const backoffDelay = (backoff: Backoff, attempt: number): number =>
  backoff.type === "exponential" ? backoff.delayMs * 2 ** Math.max(0, attempt - 1) : backoff.delayMs;
