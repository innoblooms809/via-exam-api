// ─── OCR helpers for AI evaluation (Pipeline 6) ─────────────────────────────────
//
// 1. `ocrDocument` — the ONLY place that talks to the OCR server (ocr_server.py,
//    port 8000). Every call goes through a small limiter, so the OCR server never
//    receives more requests at once than EVAL_OCR_CONCURRENCY (default 1); extra
//    callers simply wait their turn.
//
// 2. `getAnswerKeyText` — OCR for an UPLOADED model answer sheet (PDF / image).
//    The file is read by OCR ONCE and the text is saved on the answer sheet row:
//
//        viaexam_question_paper_answers.answers = { pdfUrl, ocr: { text, sourceUrl, at } }
//
//    Every later student evaluation reuses the saved text instead of OCR-ing the
//    same model answer again. Re-uploading the PDF replaces `answers`, so a stale
//    cache is dropped automatically (and `sourceUrl` is checked as well).
//    Concurrent evaluations of the same answer key share ONE in-flight OCR run.

import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import { pythonServices } from "../config/pythonServices";
import logger from "../config/logger";

const OCR_TIMEOUT_MS = 3600000; // 1 hour — large multi-page PDFs on CPU are slow

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Runs at most `max` async tasks at a time; the rest wait in FIFO order. */
export function createLimiter(max: number) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const withOcrSlot = createLimiter(positiveInt(process.env.EVAL_OCR_CONCURRENCY, 1));

/** Sends one document to the OCR server and returns its markdown text. */
export async function ocrDocument(file: Buffer, fileName: string, contentType?: string): Promise<string> {
  return withOcrSlot(async () => {
    const form = new FormData();
    form.append("file", file, { filename: fileName, contentType: contentType || undefined });

    const res = await axios.post(pythonServices.ocrUrl(), form, {
      headers: form.getHeaders(),
      timeout: OCR_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return String(res.data?.combined_markdown ?? "");
  });
}

/** Downloads an answer-key file (absolute URL, or a local /uploads path). */
async function loadFile(url: string): Promise<{ buffer: Buffer; fileName: string }> {
  const ext = (url.split("?")[0].match(/\.(pdf|png|jpe?g|webp)$/i)?.[0] ?? ".pdf").toLowerCase();
  const fileName = `answer_key${ext}`;

  if (/^https?:\/\//i.test(url)) {
    const res = await axios.get(url, { responseType: "arraybuffer", timeout: 120000 });
    return { buffer: Buffer.from(res.data), fileName };
  }

  // Files stored by this server (e.g. "/uploads/…") are read straight from disk.
  const localPath = path.join(process.cwd(), url.replace(/^\/+/, "").replace(/^v1\//, ""));
  return { buffer: await fs.promises.readFile(localPath), fileName };
}

const parseAnswers = (value: unknown): Record<string, any> | null => {
  let data = value;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, any>) : null;
};

const inFlight = new Map<string, Promise<string>>();

/**
 * Text of an uploaded model answer sheet — from the saved OCR cache when present,
 * otherwise OCR-ed once, saved, and returned. Returns null when the answer sheet
 * has typed answers (nothing to OCR).
 */
export async function getAnswerKeyText(answerId: string): Promise<string | null> {
  const row = await QuestionPaperAnswer.findOne({ where: { answerId } });
  const answers = parseAnswers(row?.answers);
  const sourceUrl: string | undefined = answers?.pdfUrl || answers?.fileUrl;
  if (!row || !answers || !sourceUrl) return null;

  // Cache hit: this exact file was already read.
  if (answers.ocr?.sourceUrl === sourceUrl && typeof answers.ocr?.text === "string" && answers.ocr.text.trim()) {
    return answers.ocr.text;
  }

  const key = `${answerId}:${sourceUrl}`;
  const running = inFlight.get(key);
  if (running) return running; // another evaluation is already reading this key

  const job = (async () => {
    logger.info(`[AnswerKey OCR] Reading uploaded model answer ${answerId} once: ${sourceUrl}`);
    const { buffer, fileName } = await loadFile(sourceUrl);
    const text = (await ocrDocument(buffer, fileName)).trim();
    if (!text) throw new Error("The OCR server returned no text for the uploaded model answer sheet.");

    // Save only if the file was not replaced while we were reading it.
    const fresh = await QuestionPaperAnswer.findOne({ where: { answerId } });
    const freshAnswers = parseAnswers(fresh?.answers);
    if (fresh && freshAnswers && (freshAnswers.pdfUrl || freshAnswers.fileUrl) === sourceUrl) {
      await fresh.update({
        answers: { ...freshAnswers, ocr: { text, sourceUrl, at: new Date().toISOString() } },
      });
    }
    logger.info(`[AnswerKey OCR] Saved OCR text for model answer ${answerId} (${text.length} chars).`);
    return text;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, job);
  return job;
}

/**
 * Starts reading a freshly uploaded model answer in the background, so the first
 * student evaluation does not have to wait for it. Failures are only logged — the
 * evaluation will simply try again.
 */
export function warmAnswerKeyOcr(answerId: string): void {
  getAnswerKeyText(answerId).catch((err) =>
    logger.warn(`[AnswerKey OCR] Background read of model answer ${answerId} failed: ${err?.message || err}`)
  );
}
