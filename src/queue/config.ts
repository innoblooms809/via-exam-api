/**
 * Job queues — settings from the environment.
 *
 *   QUEUE_DRIVER=postgres     BullMQ on the app's own PostgreSQL (schema "bullmq"). No Redis.
 *   QUEUE_DRIVER=memory       in-process queues (tests, quick local runs); jobs don't survive a restart.
 *   QUEUE_WORKERS=false       this process only adds jobs; `npm run worker` (src/worker.ts) runs them.
 *   QUEUE_DATABASE_URL        queue database; defaults to the app's DB_HOST / DB_PORT / DB_USER /
 *                             DB_PASSWORD / DB_NAME (DB_SSL=true for TLS).
 *   QUEUE_SCHEMA              PostgreSQL schema BullMQ keeps its tables in (default "bullmq").
 *   QUEUE_FALLBACK=false      fail instead of falling back to in-process queues when the
 *                             PostgreSQL queue can't start (missing CREATE rights, PostgreSQL < 13).
 *   QUEUE_SECRET              key that seals secret job data (credential emails); defaults to a
 *                             key derived from JWT_SECRET.
 *
 * Per-queue concurrency is read where each queue is defined.
 */

import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export type QueueDriverKind = "postgres" | "memory";

const flag = (value: string | undefined, fallback: boolean) => {
  if (value === undefined || value.trim() === "") return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
};

export const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const driver = (): QueueDriverKind => {
  const raw = String(process.env.QUEUE_DRIVER ?? "").trim().toLowerCase();
  if (raw === "memory" || raw === "postgres") return raw;
  return process.env.NODE_ENV === "test" ? "memory" : "postgres";
};

/** node-postgres pool settings for the queue database. */
const connection = () => {
  const ssl = flag(process.env.QUEUE_DB_SSL ?? process.env.DB_SSL, false) ? { rejectUnauthorized: false } : undefined;
  const url = String(process.env.QUEUE_DATABASE_URL ?? "").trim();
  if (url) return { connectionString: url, ...(ssl ? { ssl } : {}) };
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ...(ssl ? { ssl } : {}),
  };
};

export const queueConfig = {
  driver: driver(),
  schema: String(process.env.QUEUE_SCHEMA || "bullmq").trim(),
  runWorkers: flag(process.env.QUEUE_WORKERS, true),
  fallbackToMemory: flag(process.env.QUEUE_FALLBACK, true),
  /** Connections for queue commands; each worker also holds one for LISTEN on top of these. */
  poolMax: positiveInt(process.env.QUEUE_DB_POOL_MAX, 6),
  connection: connection(),
  secret: String(process.env.QUEUE_SECRET || process.env.JWT_SECRET || ""),
  /** How long a stopping process waits for running jobs before leaving them to be picked up again. */
  shutdownGraceMs: positiveInt(process.env.QUEUE_SHUTDOWN_GRACE_MS, 10_000),
};
