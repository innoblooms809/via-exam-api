/**
 * Student spreadsheet uploads as queued jobs ("student-import").
 *
 * A file can carry up to MAX_BULK_ROWS students, and every row is a password hash plus a
 * few writes in its own transaction, so a big file takes minutes: far longer than a
 * request should be held open. So the upload is a job:
 *
 *   startImport        queues the rows (sealed: they carry personal data and passwords)
 *   waitForImport      the upload request waits a few seconds, so a small file still answers
 *                      at once with its result; a bigger one answers 202 with the import id
 *   importStatus       GET /student/bulk-import/:importId: progress, then the result
 *
 * The job records its progress (rows done, students added, rows rejected) every few rows,
 * with the run's plan (ids and generated passwords) sealed in it, so a worker that dies
 * halfway resumes where it was: rows it had saved are recognised, not reported as
 * duplicates. Each new student's login email is queued as soon as the row is saved.
 * An import that outlives the request ends with a notification to the admin (pushed to
 * their browsers by Firebase like every notification).
 */

import { randomUUID } from "crypto";
import httpStatus from "http-status";
import logger from "../../config/logger";
import { defineQueue, PermanentJobError, type JobView } from "../../queue";
import { positiveInt } from "../../queue/config";
import { seal, unseal } from "../../queue/sealed";
import { composeUserCredentials, queueEmail } from "../../utils/mailHelper";
import { MAX_BULK_ROWS } from "../../validations/student.validation";
import { notifyAll } from "../notification/notifyPeople";
import StudentBulkService, { type BulkRowError, type BulkRowSuccess, type ImportPlanRow, type ImportState } from "./studentBulk.service";

const DAY_SEC = 24 * 60 * 60;

/** How long the upload request waits for its import before answering 202. */
export const IMPORT_WAIT_MS = positiveInt(process.env.STUDENT_IMPORT_WAIT_MS, 6_000);
/** Progress is recorded at least every this many rows, or this often. */
const SAVE_EVERY_ROWS = 25;
const SAVE_EVERY_MS = 2_000;
/** Results (with generated passwords) are kept this long, then removed with the job. */
const KEEP_RESULT_SEC = 3 * DAY_SEC;

interface ImportInput {
  students: any[];
  loginUrl: string;
}

interface ImportJob {
  importId: string;
  instituteId: string;
  /** The admin who uploaded the file. */
  userId: string;
  total: number;
  queuedAt: number;
  /** ImportInput, sealed. */
  sealed: string;
}

/** What the job reports as it goes. `state` (sealed) is only there while it runs. */
interface ImportProgress {
  done: number;
  total: number;
  created: number;
  failed: number;
  state?: string;
}

type Checkpoint = ImportState & { plan: ImportPlanRow[] };

interface ImportResult {
  statusCode: number;
  message: string;
  data: {
    totalRows: number;
    created: number;
    failed: number;
    counts: Record<string, number>;
    successes: BulkRowSuccess[];
    errors: BulkRowError[];
    skipped: number;
  };
}

const failedRows = (errors: BulkRowError[]) => new Set(errors.map((e) => e.rowNumber)).size;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ─── Queue ────────────────────────────────────────────────────────────────────

const importQueue = defineQueue<ImportJob>({
  name: "student-import",
  // Imports are heavy (a password hash per row); one at a time per worker process.
  concurrency: positiveInt(process.env.STUDENT_IMPORT_CONCURRENCY, 1),
  defaults: { attempts: 3, backoff: { type: "exponential", delayMs: 30_000 }, keepCompletedSec: KEEP_RESULT_SEC, keepFailedSec: 7 * DAY_SEC },
  lockMs: 120_000,
  maxStalls: 2,
  processor: async (job) => {
    const input = unseal<ImportInput>(job.data.sealed);
    const last = job.lastProgress as ImportProgress | 0 | null;
    const resume = last && typeof last === "object" && last.state ? unseal<Checkpoint>(last.state) : null;
    if (resume) logger.info(`[StudentImport] ${job.data.importId}: resuming at row ${resume.done} of ${job.data.total}.`);

    let plan: ImportPlanRow[] = resume?.plan ?? [];
    let savedAt = 0;
    let savedRows = resume?.done ?? 0;
    const save = async (state: ImportState) => {
      const progress: ImportProgress = {
        done: state.done,
        total: job.data.total,
        created: state.successes.length,
        failed: failedRows(state.errors),
        state: seal({ ...state, plan } satisfies Checkpoint),
      };
      await job.progress(progress as unknown as Record<string, unknown>);
      savedAt = Date.now();
      savedRows = state.done;
    };

    const result = await StudentBulkService.runImport(input.students, { instituteId: job.data.instituteId }, {
      resume,
      onPlan: async (p) => {
        plan = p;
        await save({ done: 0, successes: [], errors: [] });
      },
      onRow: async (state) => {
        if (state.done - savedRows >= SAVE_EVERY_ROWS || Date.now() - savedAt >= SAVE_EVERY_MS) await save(state);
      },
      onCreated: async (student) => {
        // Only generated passwords are emailed; an admin who typed one hands it out themselves.
        if (!student.generatedPassword || !student.email) return;
        try {
          await queueEmail({
            kind: "new-account",
            message: composeUserCredentials({
              userName: student.name,
              email: student.email,
              phone: student.mobile,
              password: student.generatedPassword,
              role: "Student",
              loginUrl: input.loginUrl,
            }),
            bulk: true,
            // A resumed run that finds this row saved queues the same email id, not a second email.
            jobId: `new-account-import-${job.data.importId}-${student.rowNumber}`,
          });
        } catch (err: any) {
          logger.warn(`[StudentImport] Login email for row ${student.rowNumber} could not be queued: ${err?.message || err}`);
        }
      },
    });

    if (result.error) {
      // A missing institute or setup won't change on retry; a database error might.
      if (Number(result.statusCode) >= 500) throw new Error(result.message);
      throw new PermanentJobError(result.message);
    }

    const data = result.data as ImportResult["data"];
    // The sealed plan is no longer needed: the result below carries what the admin sees.
    await job.progress({ done: data.totalRows, total: data.totalRows, created: data.created, failed: data.failed });

    // The admin who waited saw the result already; one who got a 202 is told it finished.
    if (Date.now() - job.data.queuedAt > IMPORT_WAIT_MS) {
      const { created, failed, totalRows } = data;
      await notifyAll([
        {
          instituteId: job.data.instituteId,
          userId: job.data.userId,
          type: "STUDENT_IMPORT_DONE",
          title: created === 0 ? "Student upload: no students added" : "Student upload finished",
          message:
            created === 0
              ? `None of the ${plural(totalRows, "row", "rows")} could be added. Open to see what needs fixing.`
              : failed === 0
                ? `All ${plural(created, "student was", "students were")} added.`
                : `${created} of ${totalRows} students were added. ${plural(failed, "row needs", "rows need")} fixing: open to see why.`,
          referenceId: job.data.importId,
        },
      ]).catch((err) => logger.warn(`[StudentImport] Completion notice not sent: ${err?.message || err}`));
    }

    return { sealed: seal({ statusCode: result.statusCode, message: result.message, data } satisfies ImportResult) };
  },
  onFailed: async (job: JobView<ImportJob>, err) => {
    logger.error(`[StudentImport] ${job.data.importId} failed: ${err?.message || err}`);
    if (Date.now() - job.data.queuedAt <= IMPORT_WAIT_MS) return; // the request reported it
    const p = (job.progress ?? {}) as ImportProgress;
    await notifyAll([
      {
        instituteId: job.data.instituteId,
        userId: job.data.userId,
        type: "STUDENT_IMPORT_FAILED",
        title: "Student upload stopped",
        message: `The upload of ${plural(job.data.total, "student", "students")} stopped: ${String(err?.message || err).slice(0, 200)}${
          p.created ? ` The ${plural(p.created, "student", "students")} added before it stopped are kept.` : ""
        }`,
        referenceId: job.data.importId,
      },
    ]).catch((e) => logger.warn(`[StudentImport] Failure notice not sent: ${e?.message || e}`));
  },
});

// ─── API ──────────────────────────────────────────────────────────────────────

export type ImportStatusKind = "queued" | "processing" | "completed" | "failed";

export interface ImportStatus {
  importId: string;
  status: ImportStatusKind;
  total: number;
  done: number;
  created: number;
  failed: number;
  /** Uploads ahead of this one while it waits. */
  position: number;
  /** Why it failed. */
  reason: string | null;
  /** Once completed: what the upload request returns for a file it finished. */
  result: ImportResult | null;
}

/** Queues an uploaded file's rows. */
export async function startImport(students: unknown, admin: any, loginUrl: string): Promise<{ error: true; statusCode: number; message: string } | { error: false; importId: string }> {
  if (!Array.isArray(students) || students.length === 0) {
    return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "The uploaded file contains no student rows." };
  }
  if (students.length > MAX_BULK_ROWS) {
    return { error: true, statusCode: httpStatus.BAD_REQUEST, message: `You can upload a maximum of ${MAX_BULK_ROWS} students at a time. Please split the file.` };
  }
  if (!admin?.instituteId || !admin?.userId) {
    return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for this admin." };
  }
  const importId = randomUUID();
  await importQueue.add(
    "import",
    {
      importId,
      instituteId: admin.instituteId,
      userId: admin.userId,
      total: students.length,
      queuedAt: Date.now(),
      sealed: seal({ students, loginUrl } satisfies ImportInput),
    },
    { jobId: importId }
  );
  return { error: false, importId };
}

const toStatus = (job: JobView<ImportJob>): ImportStatus => {
  const p = (job.progress && typeof job.progress === "object" ? job.progress : {}) as Partial<ImportProgress>;
  const base = {
    importId: job.data.importId,
    total: job.data.total,
    done: Number(p.done) || 0,
    created: Number(p.created) || 0,
    failed: Number(p.failed) || 0,
    position: 0,
    reason: null as string | null,
    result: null as ImportResult | null,
  };
  if (job.state === "completed") {
    const sealed = (job.returnValue as { sealed?: string } | null)?.sealed;
    const result = sealed ? unseal<ImportResult>(sealed) : null;
    return { ...base, status: "completed", done: job.data.total, created: result?.data.created ?? base.created, failed: result?.data.failed ?? base.failed, result };
  }
  if (job.state === "failed") return { ...base, status: "failed", reason: job.failedReason || "The upload stopped." };
  // Running, or waiting for a retry after it started.
  if (job.state === "active" || job.attemptsMade > 0) return { ...base, status: "processing" };
  return { ...base, status: "queued", position: Math.max(0, job.position - 1) };
};

/** An import of the admin's institute (null when there is none, or it was removed after KEEP_RESULT_SEC). */
export async function importStatus(importId: string, admin: any): Promise<ImportStatus | null> {
  if (!/^[0-9a-f-]{36}$/i.test(String(importId))) return null;
  const job = await importQueue.getJob(importId);
  if (!job || job.data.instituteId !== admin?.instituteId) return null;
  return toStatus(job);
}

/** Waits up to `ms` for an import to finish; returns its latest status either way. */
export async function waitForImport(importId: string, admin: any, ms = IMPORT_WAIT_MS): Promise<ImportStatus | null> {
  const until = Date.now() + ms;
  let delay = 150;
  for (;;) {
    const status = await importStatus(importId, admin);
    if (!status || status.status === "completed" || status.status === "failed" || Date.now() >= until) return status;
    await new Promise((r) => setTimeout(r, Math.min(delay, Math.max(0, until - Date.now()))));
    delay = Math.min(1_000, delay * 2);
  }
}

export default { startImport, importStatus, waitForImport, IMPORT_WAIT_MS };
