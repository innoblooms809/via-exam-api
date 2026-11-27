/**
 * Who takes the jobs (PostgreSQL driver).
 *
 * A process started with QUEUE_WORKERS=false only adds jobs. When no worker process runs
 * (`npm run worker`; on the server the pm2 "worker" app), nothing takes them: sheets sat in line
 * while the queue page said "Starting OCR…" and nothing told anyone why. So every process that
 * runs workers keeps a row in a small table of the queue's own schema, refreshed every 10 s, with
 * what it can tell the others: the health of the evaluation services, which only a process calling
 * them knows. A process counts as running while its row is younger than 45 s (database time, so the
 * clocks of different machines don't matter); one that stops cleanly removes its row at once.
 *
 * Why not BullMQ's getWorkers(): it lists every named connection of the database, so the server's
 * workers, which keep their jobs in another schema of the same database, would count as ours.
 *
 * A worker of an older version announces nothing; until one of this version has written its row,
 * such workers are recognised by their connections instead (unannounced), so an API updated before
 * its workers never shows the queue on hold while they work.
 */

import os from "os";
import type { PgPool } from "bullmq";
import logger from "../config/logger";
import type { WorkerPresence } from "./types";

/** A pg client or pool: all this needs of either. */
type Queryable = { query(text: string, params?: readonly unknown[]): Promise<{ rows: any[] }> };

export const PRESENCE_EVERY_MS = 10_000;
export const PRESENCE_TTL_MS = 45_000;
/** Rows of processes that died without removing theirs are deleted after this long. */
const FORGET_AFTER = "1 day";

const TABLE = "viaexam_queue_presence";

/** This process, named as the queue logs name processes. */
export const presenceInstance = { id: `${os.hostname()}#${process.pid}`, host: os.hostname(), pid: process.pid };

/**
 * Creates the table in the queue's schema (`schemaSql`, already quoted) when it is missing.
 * Returns the table's qualified name, or null when it can't be made: the queue still works then,
 * but no process can tell whether a worker runs.
 */
export async function ensurePresenceTable(client: Queryable, schemaSql: string): Promise<string | null> {
  const table = `${schemaSql}.${TABLE}`;
  const ddl = `CREATE TABLE IF NOT EXISTS ${table} (
      instance_id text PRIMARY KEY,
      host        text NOT NULL,
      pid         integer NOT NULL,
      started_at  timestamptz NOT NULL,
      beat_at     timestamptz NOT NULL DEFAULT now(),
      queues      text[] NOT NULL DEFAULT '{}',
      info        jsonb NOT NULL DEFAULT '{}'::jsonb
    )`;
  for (let attempt = 1; ; attempt++) {
    try {
      await client.query(ddl);
      return table;
    } catch (err: any) {
      // Two processes creating it at the same moment: one wins, the other finds it on the next try.
      if (attempt < 3 && (err?.code === "23505" || err?.code === "42P07")) continue;
      logger.warn(`[Queue] Can't keep the list of running workers (${err?.message || err}); the queue page won't know when none runs.`);
      return null;
    }
  }
}

export class PostgresPresence {
  private timer: NodeJS.Timeout | null = null;
  private announced: { queues: string[]; info: () => Record<string, unknown> } | null = null;
  private readonly startedAt = Date.now();
  private beats = 0;
  private failing = false;

  /** `table`: from ensurePresenceTable; null leaves the list unknown (workers() answers null). */
  constructor(private readonly pool: PgPool, private readonly table: string | null) {}

  async announce(queues: string[], info: () => Record<string, unknown>): Promise<void> {
    if (!this.table) return;
    this.announced = { queues, info };
    await this.beat();
    if (!this.timer) {
      this.timer = setInterval(() => void this.beat(), PRESENCE_EVERY_MS);
      this.timer.unref?.();
    }
  }

  private async beat(): Promise<void> {
    const announced = this.announced;
    if (!announced || !this.table) return;
    let info: Record<string, unknown> = {};
    try {
      info = announced.info() ?? {};
    } catch {
      /* the sign of life goes without it */
    }
    try {
      await this.pool.query(
        `INSERT INTO ${this.table} (instance_id, host, pid, started_at, beat_at, queues, info)
         VALUES ($1, $2, $3, to_timestamp($4::float8 / 1000), now(), $5, $6::jsonb)
         ON CONFLICT (instance_id) DO UPDATE SET beat_at = now(), queues = EXCLUDED.queues, info = EXCLUDED.info`,
        [presenceInstance.id, presenceInstance.host, presenceInstance.pid, this.startedAt, announced.queues, JSON.stringify(info)]
      );
      if (this.beats++ % 60 === 0) await this.pool.query(`DELETE FROM ${this.table} WHERE beat_at < now() - interval '${FORGET_AFTER}'`);
      if (this.failing) logger.info("[Queue] This worker's sign of life is saved again.");
      this.failing = false;
    } catch (err: any) {
      // Once per run of failures: a database hiccup must not flood the log.
      if (!this.failing) logger.warn(`[Queue] Could not save this worker's sign of life (${err?.message || err}); other processes may think no worker runs.`);
      this.failing = true;
    }
  }

  async workers(): Promise<WorkerPresence[] | null> {
    if (!this.table) return null;
    // Every row, not only the live ones: a table nobody ever wrote to means something else (below).
    const { rows } = await this.pool.query(
      `SELECT instance_id, host, pid, queues, info,
              (EXTRACT(EPOCH FROM started_at) * 1000)::float8 AS started_ms,
              (EXTRACT(EPOCH FROM beat_at) * 1000)::float8 AS beat_ms,
              beat_at > now() - ($1::int * interval '1 millisecond') AS alive
         FROM ${this.table}
        ORDER BY started_at`,
      [PRESENCE_TTL_MS]
    );
    const list: WorkerPresence[] = rows.filter((r: any) => r.alive).map((r: any) => ({
      instance: String(r.instance_id),
      host: String(r.host),
      pid: Number(r.pid),
      self: r.instance_id === presenceInstance.id,
      startedAt: Number(r.started_ms),
      lastSeenAt: Number(r.beat_ms),
      queues: Array.isArray(r.queues) ? r.queues.map(String) : [],
      info: r.info && typeof r.info === "object" ? r.info : {},
    }));
    // This process takes jobs even while its row can't be written (or before the first one is).
    const announced = this.announced;
    if (announced && !list.some((w) => w.self)) {
      list.push({
        instance: presenceInstance.id,
        host: presenceInstance.host,
        pid: presenceInstance.pid,
        self: true,
        startedAt: this.startedAt,
        lastSeenAt: Date.now(),
        queues: announced.queues,
        info: {},
      });
    }
    // No row at all: no worker of this version has run here (or the last one stopped cleanly). One
    // of an older version announces nothing but may be running; count it rather than call the
    // queue on hold while it works.
    if (!rows.length) {
      const older = await this.unannounced().catch(() => null);
      if (older) list.push(older);
    }
    return list;
  }

  /**
   * Workers that don't announce themselves (an older version). BullMQ names each worker's LISTEN
   * connection after its queue (that is how its getWorkers() finds them); coming from this
   * machine's address they are ours, while the server's workers, whose jobs live in another schema
   * of the same database, connect from elsewhere. It only ever adds workers: it can't put a stage on
   * hold by mistake, and once a worker of this version has written its row it is no longer asked.
   */
  private async unannounced(): Promise<WorkerPresence | null> {
    const { rows } = await this.pool.query(
      `SELECT DISTINCT split_part(application_name, ':w:', 1) AS queue
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND application_name NOT IN ('', 'viaexam-queue')
          AND client_addr IS NOT DISTINCT FROM inet_client_addr()`
    );
    const queues = rows.map((r: any) => String(r.queue ?? "")).filter(Boolean);
    if (!queues.length) return null;
    return { instance: "unannounced (older version)", host: "", pid: 0, self: false, startedAt: 0, lastSeenAt: Date.now(), queues, info: {} };
  }

  /** Stops the sign of life and removes this process's row, so the others know at once. */
  async leave(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.announced || !this.table) return;
    this.announced = null;
    await this.pool.query(`DELETE FROM ${this.table} WHERE instance_id = $1`, [presenceInstance.id]).catch(() => undefined);
  }
}
