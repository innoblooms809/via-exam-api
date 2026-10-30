/**
 * Scan-quality checks for uploaded answer sheets.
 *
 * The measuring is in utils/sheetQuality; this file runs it off the main thread
 * and records the result on the sheet (qualityFlag, qualityReport).
 *
 *   • A small pool of worker threads does the work, so a 30-page booklet never
 *     stalls other requests.
 *   • A check starts as soon as a file is accepted, alongside its upload to
 *     Cloudinary. The upload response waits a few seconds for it, then leaves it
 *     to finish in the background.
 *   • A result is written only if the sheet still holds the file that was
 *     checked, so a slow check can't overwrite the report of a replacement scan.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { Worker } from "worker_threads";

import Scanner from "../../models/Scanner.model";
import logger from "../../config/logger";
import { settingsOf } from "../academic/instituteSettings.service";
import { resolveSheetBuffer } from "../../utils/answerSheetStorage";
import {
  DEFAULT_SCAN_QUALITY,
  SHEET_QUALITY_VERSION,
  type PageQuality,
  type QualityFlag,
  type ScanQualityRule,
  type SheetQualityReport,
} from "../../utils/sheetQuality";

// How long the upload response waits for a sheet's check once the sheet is stored.
export const QUALITY_WAIT_MS = 4_000;
// A check still running after this is given up (and its worker replaced).
const JOB_TIMEOUT_MS = 3 * 60_000;
const POOL_SIZE = Math.max(1, Number(process.env.SHEET_QUALITY_WORKERS) || Math.min(2, Math.max(1, os.cpus().length - 1)));

// ─── Worker pool ──────────────────────────────────────────────────────────────

interface Job {
  id: number;
  pdf: Uint8Array;
  rule: ScanQualityRule;
  resolve: (report: SheetQualityReport) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  job: Job | null;
  timer: NodeJS.Timeout | null;
}

const queue: Job[] = [];
const slots: Slot[] = [];
let nextJobId = 1;

// Under ts-node (dev, and `npm start`) the worker has to register it too.
const spawnWorker = (): Worker => {
  const ext = path.extname(__filename);
  const file = path.join(__dirname, "..", "..", "utils", `sheetQuality.worker${ext}`);
  const code = `${ext === ".ts" ? 'require("ts-node/register/transpile-only");' : ""}require(${JSON.stringify(file)});`;
  const worker = new Worker(code, { eval: true });
  // An idle pool never keeps the process (or a script) alive.
  worker.unref();
  return worker;
};

const finish = (slot: Slot) => {
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  slot.job = null;
  pump();
};

const replace = (slot: Slot, reason: string) => {
  const job = slot.job;
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  slot.job = null;
  void slot.worker.terminate().catch(() => null);
  slots.splice(slots.indexOf(slot), 1);
  job?.reject(new Error(reason));
  pump();
};

const addSlot = (): Slot => {
  const slot: Slot = { worker: spawnWorker(), job: null, timer: null };
  slot.worker.on("message", (msg: { id: number; report?: SheetQualityReport; error?: string }) => {
    const job = slot.job;
    if (!job || job.id !== msg.id) return;
    if (msg.report) job.resolve(msg.report);
    else job.reject(new Error(msg.error || "quality check failed"));
    finish(slot);
  });
  slot.worker.on("error", (err) => replace(slot, err?.message || "quality worker crashed"));
  slot.worker.on("exit", (code) => {
    if (slots.includes(slot)) replace(slot, `quality worker exited (${code})`);
  });
  slots.push(slot);
  return slot;
};

function pump() {
  while (queue.length) {
    const slot = slots.find((s) => !s.job) ?? (slots.length < POOL_SIZE ? addSlot() : null);
    if (!slot) return;
    const job = queue.shift()!;
    slot.job = job;
    slot.timer = setTimeout(() => replace(slot, "quality check timed out"), JOB_TIMEOUT_MS);
    slot.worker.ref();
    slot.worker.postMessage({ id: job.id, pdf: job.pdf, rule: job.rule }, [job.pdf.buffer as ArrayBuffer]);
  }
  for (const s of slots) if (!s.job) s.worker.unref();
}

const runInPool = (pdf: Uint8Array, rule: ScanQualityRule): Promise<SheetQualityReport> =>
  new Promise((resolve, reject) => {
    queue.push({ id: nextJobId++, pdf, rule, resolve, reject });
    pump();
  });

// ─── Reports ──────────────────────────────────────────────────────────────────

const uncheckedReport = (rule: ScanQualityRule, reason: string): SheetQualityReport => ({
  version: SHEET_QUALITY_VERSION,
  flag: "unchecked",
  reasons: [reason],
  pageCount: 0,
  pages: [],
  rule,
  checkedAt: new Date().toISOString(),
  ms: 0,
});

/** The school's thresholds, or the defaults. */
export const scanQualityRule = async (instituteId: string): Promise<ScanQualityRule> =>
  (await settingsOf(instituteId)).scanQuality;

/** Measures a PDF. Never throws: a sheet that can't be read is "unchecked". */
export const checkPdf = async (pdf: Uint8Array, rule: ScanQualityRule = DEFAULT_SCAN_QUALITY): Promise<SheetQualityReport> => {
  try {
    // The pool takes the bytes; the caller's buffer stays usable.
    return await runInPool(new Uint8Array(pdf), rule);
  } catch (err: any) {
    logger.warn(`[SheetQuality] Check failed: ${err?.message || err}`);
    return uncheckedReport(rule, "The scan quality could not be checked (the PDF's pages could not be read).");
  }
};

/** What every screen shows (scanner, evaluator, admin): the flag, why, and each page's numbers. */
export interface QualitySummary {
  flag: QualityFlag;
  reasons: string[];
  checkedAt: string;
  pages: Pick<PageQuality, "page" | "flag" | "issues" | "dpi" | "sharpness" | "contrast">[];
}

export const qualitySummary = (report: SheetQualityReport | null | undefined): QualitySummary | null =>
  report
    ? {
        flag: report.flag,
        reasons: report.reasons ?? [],
        checkedAt: report.checkedAt,
        pages: (report.pages ?? []).map(({ page, flag, issues, dpi, sharpness, contrast }) => ({ page, flag, issues, dpi, sharpness, contrast })),
      }
    : null;

/** A sheet row's quality (qualityFlag + qualityReport); null until checked. */
export const scanQualityView = (sheet: { qualityFlag?: string | null; qualityReport?: SheetQualityReport | null } | null | undefined): QualitySummary | null =>
  sheet?.qualityFlag && sheet.qualityReport ? qualitySummary({ ...sheet.qualityReport, flag: sheet.qualityFlag as QualityFlag }) : null;

/** Saves a report, unless the sheet has since been given another file. */
const record = async (sheetId: string, publicId: string | null, report: SheetQualityReport) => {
  const [count] = await Scanner.update(
    { qualityFlag: report.flag, qualityReport: report },
    { where: { sheetId, isDeleted: false, ...(publicId ? { filePublicId: publicId } : {}) } },
  );
  if (!count) logger.info(`[SheetQuality] ${sheetId}: file changed during the check, result dropped.`);
};

// ─── Upload flow ──────────────────────────────────────────────────────────────

/**
 * Starts checking a temp upload. Reads the file now, so the temp file can be
 * removed whenever the upload is done with it. Resolves null when the school has
 * the check turned off.
 */
export const beginQualityCheck = (filePath: string, rule: ScanQualityRule): Promise<SheetQualityReport | null> => {
  if (!rule.enabled) return Promise.resolve(null);
  return fs.promises
    .readFile(filePath)
    .then((buf) => checkPdf(buf, rule))
    .catch((err) => {
      logger.warn(`[SheetQuality] Could not read ${filePath}: ${err?.message || err}`);
      return uncheckedReport(rule, "The scan quality could not be checked.");
    });
};

/**
 * Once a sheet is stored: saves its check whenever it finishes, and returns it
 * if that happens within `waitMs` (else null, and the flag lands later).
 */
export const settleQualityCheck = async (
  sheetId: string,
  publicId: string | null,
  check: Promise<SheetQualityReport | null>,
  waitMs = QUALITY_WAIT_MS,
): Promise<SheetQualityReport | null> => {
  const saved = check.then(async (report) => {
    if (report) await record(sheetId, publicId, report).catch((err) => logger.warn(`[SheetQuality] Save ${sheetId}: ${err?.message || err}`));
    return report;
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  const result = await Promise.race([saved, timeout]);
  clearTimeout(timer);
  return result;
};

// ─── Sheets already stored ────────────────────────────────────────────────────

const running = new Set<string>();

/**
 * Checks a stored sheet (downloads it from Cloudinary). Used for sheets uploaded
 * before the check existed. Returns null if it is already running, or the sheet
 * has no file.
 */
export const checkStoredSheet = async (sheetId: string): Promise<SheetQualityReport | null> => {
  if (running.has(sheetId)) return null;
  running.add(sheetId);
  try {
    const sheet = await Scanner.findOne({ where: { sheetId, isDeleted: false } });
    if (!sheet || sheet.fileMimeType !== "application/pdf") return null;
    const rule = await scanQualityRule(sheet.instituteId);
    if (!rule.enabled) return null;
    const buf = await resolveSheetBuffer(sheet);
    if (!buf) return null;
    const report = await checkPdf(buf, rule);
    await record(sheet.sheetId, sheet.filePublicId, report);
    return report;
  } catch (err: any) {
    logger.warn(`[SheetQuality] Stored sheet ${sheetId}: ${err?.message || err}`);
    return null;
  } finally {
    running.delete(sheetId);
  }
};

/** Fire and forget: a sheet opened for evaluation that was never checked gets checked now. */
export const ensureSheetQuality = (sheet: { sheetId: string; qualityFlag?: string | null; fileMimeType?: string } | null | undefined) => {
  if (!sheet || sheet.qualityFlag || sheet.fileMimeType !== "application/pdf") return;
  void checkStoredSheet(sheet.sheetId);
};
