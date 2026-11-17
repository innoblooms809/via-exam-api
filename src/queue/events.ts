/**
 * What happens to every job, as events: both drivers emit them, the queue log
 * (services/evaluation/evaluationQueueMonitor.ts) writes them down. A listener that throws never
 * reaches the queue.
 *
 *   added          a job joined its queue
 *   deduplicated   an add found the same job (job id / dedupe key) already there: nothing added
 *   active         an attempt started
 *   completed      the job finished
 *   retrying       an attempt failed; the job runs again after `delayMs`
 *   failed         the job failed for good (last attempt, or an error retrying can't fix)
 *   rate-limited   the job's service is busy or down: the queue pauses `delayMs`, the job keeps
 *                  its attempts and its place
 *   claim-paused   this process stopped taking the queue's jobs (it can't reach their service)
 *   claim-resumed  ... and took them up again
 */

import { EventEmitter } from "events";
import type { JobView } from "./types";

export type QueueEventType =
  | "added"
  | "deduplicated"
  | "active"
  | "completed"
  | "retrying"
  | "failed"
  | "rate-limited"
  | "claim-paused"
  | "claim-resumed";

export interface QueueEvent<T = any> {
  type: QueueEventType;
  queue: string;
  at: number;
  job?: JobView<T>;
  /** retrying: wait before the next attempt. rate-limited: how long the queue pauses. */
  delayMs?: number;
  /** completed / retrying / failed: how long the attempt ran. */
  durationMs?: number;
  error?: string;
  /** The error's failure code, when the processor gave it one. */
  errorCode?: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function emitQueueEvent(event: Omit<QueueEvent, "at">): void {
  try {
    emitter.emit("event", { ...event, at: Date.now() });
  } catch {
    /* listeners guard themselves; the queue never fails because of a log */
  }
}

/** Calls `listener` for every queue event of this process. */
export function onQueueEvent(listener: (event: QueueEvent) => void | Promise<void>): void {
  emitter.on("event", (event: QueueEvent) => {
    try {
      const pending = listener(event);
      if (pending && typeof (pending as Promise<void>).catch === "function") (pending as Promise<void>).catch(() => undefined);
    } catch {
      /* ignored: see above */
    }
  });
}
