/**
 * What the job queues are doing, for developers.
 *
 *   logs/queue.log    every event of every queue as one JSON line: queued, started, finished,
 *                     each failed attempt and its retry, pauses, failures (with code, detail,
 *                     attempts and the service address), which sheet runs next, and a summary of
 *                     the evaluation queue every minute while it has work. Rotated: QUEUE_LOG_MAX_MB
 *                     (default 20) × QUEUE_LOG_FILES (default 10). QUEUE_LOG_FILE=off turns it off.
 *   console / combined.log   the same evaluation events as one readable line each, "[EvalQueue] …"
 *   GET /v1/ai-evaluation/queue/diagnostics   (super admin) the live queue, the services' health,
 *                     the last events and other API processes on the same database
 *
 * It also keeps the evaluation services' health ("OCR unreachable since 10:12") for the queue
 * page, and warns when another API process uses this database with a queue this one can't see.
 */

import os from "os";
import path from "path";
import winston from "winston";
import { QueryTypes } from "sequelize";
import logger from "../../config/logger";
import { sequelize } from "../../config/sequelize";
import { allQueues, onQueueEvent, queueDriverKind, queueWorkersRunningHere, type QueueEvent } from "../../queue";
import { positiveInt, queueConfig } from "../../queue/config";

export const EVAL_QUEUES = new Set(["evaluation-ocr", "evaluation-ai"]);

/** This API process, as it appears in logs and saved failures. */
export const instance = {
  id: `${os.hostname()}#${process.pid}`,
  host: os.hostname(),
  pid: process.pid,
  startedAt: new Date().toISOString(),
};

// ─── Log sinks ──────────────────────────────────────────────────────────────────

const fileSetting = String(process.env.QUEUE_LOG_FILE ?? "").trim();
const fileLog =
  /^(off|false|0|no)$/i.test(fileSetting) || process.env.NODE_ENV === "test"
    ? null
    : winston.createLogger({
        level: "debug",
        format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
        transports: [
          new winston.transports.File({
            filename: fileSetting || path.join("logs", "queue.log"),
            maxsize: positiveInt(process.env.QUEUE_LOG_MAX_MB, 20) * 1024 * 1024,
            maxFiles: positiveInt(process.env.QUEUE_LOG_FILES, 10),
            tailable: true,
          }),
        ],
      });

export interface QueueLogEntry {
  ts: string;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  msg?: string;
  [field: string]: unknown;
}

const RECENT_MAX = 300;
const recent: QueueLogEntry[] = [];

const clean = (fields: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/**
 * Writes one queue event: a JSON line in queue.log (and the in-memory history the diagnostics
 * show) and, with `msg`, a readable "[EvalQueue] …" line in the main log.
 */
export function record(
  event: string,
  fields: Record<string, unknown> = {},
  options: { msg?: string; level?: QueueLogEntry["level"]; console?: boolean } = {}
): void {
  const level = options.level ?? "info";
  const entry: QueueLogEntry = { ts: new Date().toISOString(), level, event, ...(options.msg ? { msg: options.msg } : {}), ...clean(fields), instance: instance.id };
  recent.push(entry);
  if (recent.length > RECENT_MAX) recent.splice(0, recent.length - RECENT_MAX);
  try {
    fileLog?.log({ ...entry, level, message: options.msg ?? event });
  } catch {
    /* a full disk never stops the queue */
  }
  const shownByLogger = Boolean(options.msg) && options.console !== false && logger.isLevelEnabled(level);
  if (shownByLogger) logger.log(level, `[EvalQueue] ${options.msg}`);
  else mirrorToWorkerConsole(entry);
}

/**
 * QUEUE_CONSOLE=all: in a process that runs jobs (the worker), every queue.log line the console
 * doesn't already show — events written without a message, and debug ones the main logger
 * hides outside development — as "[QueueLog] event — message key=value …". The plain job
 * events ("queue.added", "queue.active", …) are left out: printQueueEvent shows those.
 */
function mirrorToWorkerConsole(entry: QueueLogEntry): void {
  try {
    if (consoleMode !== "all" || !consoleLog || !queueWorkersRunningHere()) return;
    if (entry.event.startsWith("queue.") && !entry.msg) return;
    const { ts: _ts, level, event, msg, instance: _instance, ...fields } = entry;
    const details = Object.entries(fields)
      .map(([k, v]) => `${k}=${(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 300)}`)
      .join(" ");
    consoleLog.log(level === "debug" ? "info" : level, `[QueueLog] ${event}${msg ? ` — ${msg}` : ""}${details ? ` ${details}` : ""}`);
  } catch {
    /* a log line never stops the queue */
  }
}

export const recentEvents = (limit = 200): QueueLogEntry[] => recent.slice(-Math.max(1, Math.min(limit, RECENT_MAX)));

/** "4m 05s", "1h 02m", "12s". */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "?";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

// ─── Console view of the queues ─────────────────────────────────────────────────
//
//   QUEUE_CONSOLE=all       every job of every queue as one readable line: added (in the process
//                           that adds it), started / done / retrying / failed (in the process that
//                           runs it), plus a status line of running / waiting jobs whenever it changes.
//                           Default outside production.
//   QUEUE_CONSOLE=problems  only retries, failures and pauses. Default in production.
//   QUEUE_CONSOLE=off       nothing on the console (queue.log keeps everything either way).
//   QUEUE_CONSOLE_SUMMARY_SEC  how often the status line is checked (default 30).
//
// Console only: these lines are already in queue.log, so they stay out of combined.log.
// The evaluation queues print their own "[EvalQueue] …" lines with the sheet's details.

type ConsoleMode = "all" | "problems" | "off";
const consoleMode = ((): ConsoleMode => {
  const raw = String(process.env.QUEUE_CONSOLE ?? "").trim().toLowerCase();
  if (raw === "all" || raw === "problems") return raw;
  if (/^(off|false|0|no)$/.test(raw)) return "off";
  return process.env.NODE_ENV === "production" ? "problems" : "all";
})();

const PROBLEM_EVENTS = new Set<QueueEvent["type"]>(["retrying", "failed", "rate-limited", "claim-paused", "claim-resumed"]);

const consoleLog =
  consoleMode === "off" || process.env.NODE_ENV === "test"
    ? null
    : winston.createLogger({
        level: "info",
        transports: [
          new winston.transports.Console({
            stderrLevels: ["error"],
            format: winston.format.combine(
              process.stdout.isTTY ? winston.format.colorize() : winston.format.uncolorize(),
              winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
              winston.format.printf(({ level, message, timestamp }) => `[${timestamp}] ${level}: ${message}`)
            ),
          }),
        ],
      });

const describeQueueEvent = (e: QueueEvent, attempt?: number): string => {
  const job = e.job;
  const who = job ? `${job.name} ${job.id}` : "";
  const tries = attempt && job ? ` (attempt ${attempt}/${job.maxAttempts})` : "";
  switch (e.type) {
    case "added":
      return `${who} added${e.delayMs ? `, starts in ${fmtMs(e.delayMs)}` : ""}`;
    case "deduplicated":
      return `${who} already queued, not added again`;
    case "active":
      return `${who} started${tries}`;
    case "completed":
      return `${who} done in ${e.durationMs !== undefined && e.durationMs < 10_000 ? `${(e.durationMs / 1000).toFixed(1)}s` : fmtMs(e.durationMs)}${tries}`;
    case "retrying":
      return `${who} failed${tries}: ${e.error ?? "unknown error"} — retry in ${fmtMs(e.delayMs)}`;
    case "failed":
      return `${who} FAILED for good${tries}: ${e.error ?? "unknown error"}`;
    case "rate-limited":
      return `${who} service busy or down — queue paused ${fmtMs(e.delayMs)}, the job keeps its place`;
    case "claim-paused":
      return "this process stopped taking these jobs (it can't reach their service)";
    case "claim-resumed":
      return "this process is taking these jobs again";
    default:
      return `${who} ${(e as QueueEvent).type}`;
  }
};

function printQueueEvent(e: QueueEvent, attempt?: number): void {
  if (!consoleLog) return;
  if (consoleMode === "problems" && !PROBLEM_EVENTS.has(e.type)) return;
  const level = e.type === "failed" ? "error" : e.type === "retrying" || e.type === "rate-limited" || e.type === "claim-paused" ? "warn" : "info";
  consoleLog.log(level, `[Queue] ${e.queue} | ${describeQueueEvent(e, attempt)}`);
}

// Status line, only in a process that runs jobs, only when it changed since the last one.
let lastStatus = "";
let statusRunning = false;
async function printQueueStatus(): Promise<void> {
  if (statusRunning || !queueWorkersRunningHere() || queueDriverKind() === "none") return;
  statusRunning = true;
  try {
    const parts: string[] = [];
    for (const q of allQueues()) {
      const c = await q.counts().catch(() => null);
      if (!c) continue;
      const running = c.active ?? 0;
      const waiting = (c.waiting ?? 0) + (c.prioritized ?? 0);
      // The maintenance queue always holds its next scheduled runs as delayed jobs: not work.
      const retrying = q.name === "maintenance" ? 0 : c.delayed ?? 0;
      if (!running && !waiting && !retrying) continue;
      parts.push(`${q.name}: ${running} running, ${waiting} waiting${retrying ? `, ${retrying} delayed/retrying` : ""}`);
    }
    const line = parts.length ? parts.join(" | ") : "all queues idle";
    if (line === lastStatus) return;
    lastStatus = line;
    consoleLog?.info(`[Queue] status — ${line}`);
  } finally {
    statusRunning = false;
  }
}

if (consoleLog && consoleMode === "all") {
  const timer = setInterval(() => void printQueueStatus().catch(() => undefined), positiveInt(process.env.QUEUE_CONSOLE_SUMMARY_SEC, 30) * 1000);
  timer.unref?.();
}

// Every queue except the evaluation ones (pipeline6.service logs those with the sheet's details).
onQueueEvent((e: QueueEvent) => {
  if (EVAL_QUEUES.has(e.queue)) return;
  const job = e.job;
  const level = e.type === "failed" ? "error" : e.type === "retrying" || e.type === "claim-paused" ? "warn" : "debug";
  // The attempt that started or finished (retrying / failed events already count the one that failed).
  const attempt = !job || e.type === "added" || e.type === "deduplicated" ? undefined : e.type === "retrying" || e.type === "failed" ? job.attemptsMade : job.attemptsMade + 1;
  record(`queue.${e.type}`, {
    queue: e.queue,
    jobId: job?.id,
    job: job?.name,
    attempt,
    maxAttempts: job?.maxAttempts,
    position: job?.position || undefined,
    delayMs: e.delayMs,
    durationMs: e.durationMs,
    error: e.error,
    errorCode: e.errorCode,
  }, { level });
  printQueueEvent(e, attempt);
});

// ─── Health of the evaluation services ──────────────────────────────────────────

export type EvalService = "ocr" | "ai";
const SERVICE_NAME: Record<EvalService, string> = { ocr: "OCR", ai: "AI evaluation" };

interface ServiceHealth {
  downSince: number | null;
  detail: string | null;
  target: string | null;
  lastOkAt: number | null;
}

const health: Record<EvalService, ServiceHealth> = {
  ocr: { downSince: null, detail: null, target: null, lastOkAt: null },
  ai: { downSince: null, detail: null, target: null, lastOkAt: null },
};

/** This process can't reach the service: its stage waits (logged once per outage). */
export function serviceDown(service: EvalService, detail: string, target: string, waiting?: number): void {
  const h = health[service];
  h.detail = detail;
  h.target = target;
  if (h.downSince) return;
  h.downSince = Date.now();
  record(
    "service.down",
    { service, detail, target, waiting },
    {
      level: "warn",
      msg:
        `${SERVICE_NAME[service]} service unreachable at ${target} (${detail}). Its stage is paused: sheets keep their ` +
        `place in line and start on their own once it answers${waiting !== undefined ? ` (${waiting} waiting)` : ""}.`,
    }
  );
}

/** The service answered: its stage runs again (logged when it was down). */
export function serviceUp(service: EvalService, target?: string): void {
  const h = health[service];
  h.lastOkAt = Date.now();
  if (target) h.target = target;
  if (!h.downSince) return;
  const downMs = Date.now() - h.downSince;
  h.downSince = null;
  h.detail = null;
  record("service.up", { service, target: h.target, downMs }, { msg: `${SERVICE_NAME[service]} service is reachable again after ${fmtMs(downMs)}; its stage resumes.` });
}

/** Down since when and why, or null while it answers. */
export function serviceOutage(service: EvalService): { since: number; detail: string; target: string | null } | null {
  const h = health[service];
  return h.downSince ? { since: h.downSince, detail: h.detail ?? "", target: h.target } : null;
}

export const servicesHealth = () =>
  Object.fromEntries(
    (Object.keys(health) as EvalService[]).map((s) => [
      s,
      {
        reachable: !health[s].downSince,
        downSince: health[s].downSince ? new Date(health[s].downSince!).toISOString() : null,
        detail: health[s].detail,
        target: health[s].target,
        lastOkAt: health[s].lastOkAt ? new Date(health[s].lastOkAt!).toISOString() : null,
      },
    ])
  );

// ─── Other API processes on this database ───────────────────────────────────────

export interface OtherQueueProcess {
  client: string;
  connections: number;
  since: string | null;
}

let otherProcesses: OtherQueueProcess[] = [];
let otherProcessesKey = "";

/**
 * API processes elsewhere that run the PostgreSQL job queue on this database (seen by their
 * queue connections). With in-process queues here, neither side sees the other's jobs.
 */
export async function checkOtherQueueProcesses(): Promise<OtherQueueProcess[]> {
  const names = ["viaexam-queue", ...allQueues().map((q) => q.name)];
  try {
    const rows = (await sequelize.query(
      `SELECT coalesce(host(client_addr), 'local socket') AS client, count(*)::int AS connections, min(backend_start) AS since
         FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND application_name IN (:names)
          AND client_addr IS DISTINCT FROM inet_client_addr()
        GROUP BY 1
        ORDER BY 1`,
      { replacements: { names }, type: QueryTypes.SELECT }
    )) as any[];
    otherProcesses = rows.map((r) => ({ client: String(r.client), connections: Number(r.connections), since: r.since ? new Date(r.since).toISOString() : null }));
  } catch (err: any) {
    // Without the right to read pg_stat_activity there is nothing to check.
    logger.debug(`[EvalQueue] Could not look for other queue processes: ${err?.message || err}`);
    return otherProcesses;
  }
  const key = otherProcesses.map((p) => `${p.client}@${p.since}`).join(",");
  if (key !== otherProcessesKey) {
    otherProcessesKey = key;
    if (otherProcesses.length && queueDriverKind() === "memory") {
      const list = otherProcesses.map((p) => `${p.client} (since ${p.since?.replace("T", " ").slice(0, 16) ?? "?"} UTC)`).join(", ");
      record(
        "instance.conflict",
        { others: otherProcesses, driver: "memory" },
        {
          level: "warn",
          msg:
            `Another API process uses this database with its own job queue (BullMQ on PostgreSQL), from ${list}. ` +
            "This process keeps its jobs in memory (QUEUE_DRIVER=memory), so neither sees the other's queue: its watchdog " +
            "takes over sheets queued here whose rows look idle, and fails them if its OCR / AI address doesn't work. " +
            "Live runs here keep their rows fresh to prevent that. Stop that process, or update it to this version with working " +
            "OCR / AI addresses (or QUEUE_WORKERS=false there); one database should have one job queue: QUEUE_DRIVER=postgres on every API.",
        }
      );
    } else if (otherProcesses.length) {
      // pg_stat_activity doesn't show their schema; ours tells whether we share their jobs.
      const schema = queueConfig.schema;
      record(
        "instance.peers",
        { others: otherProcesses, schema },
        {
          msg:
            `Other API processes run a job queue on this database (${otherProcesses.map((p) => p.client).join(", ")}). ` +
            (schema === "bullmq"
              ? `This process uses the default schema "bullmq": with the same schema they share its jobs, and only one that can reach OCR / AI should take them.`
              : `This process keeps its jobs in its own schema "${schema}", so they don't take each other's jobs.`),
        }
      );
    }
  }
  return otherProcesses;
}

export const knownOtherQueueProcesses = () => otherProcesses;

let watchingPeers = false;
/** Checks now and every 30 minutes (warns only when the picture changes). */
export function watchOtherQueueProcesses(): void {
  if (watchingPeers) return;
  watchingPeers = true;
  void checkOtherQueueProcesses();
  const timer = setInterval(() => void checkOtherQueueProcesses(), 30 * 60_000);
  timer.unref?.();
}
