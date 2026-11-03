/**
 * The steps of a partner evaluation. They run on the same OCR and AI evaluation queues as the
 * schools' own sheets (pipeline6.service dispatches to them), so partner traffic shares — and
 * can never exceed — the concurrency limits of the GPUs behind those servers.
 *
 *   OCR stage   the sheet's text, when the partner sent a file instead of text
 *   AI stage    POST /v1/evaluate on the evaluator (structured paper, every part marked)
 *
 * The sheet itself is dropped once the evaluation has ended, either way.
 */

import axios from "axios";
import { Op } from "sequelize";
import logger from "../../config/logger";
import { pythonServices, serviceHeaders } from "../../config/pythonServices";
import { PartnerEvaluation } from "../../models/PartnerApi.model";
import { ocrDocument } from "../evaluation/answerKeyOcr.service";
import { enqueueWebhook } from "./partnerWebhooks";
import { PARTNER_ERROR_CODES } from "./partnerResource";

const EVAL_TIMEOUT_MS = 3600000;
const OPEN = ["queued", "processing"];

const openRow = async (evaluationId: string) => {
  const row = await PartnerEvaluation.findOne({ where: { evaluationId } });
  if (!row || !OPEN.includes(row.status)) return null;
  if (row.status === "queued") await row.update({ status: "processing", startedAt: new Date() });
  return row;
};

/** Reads the sheet when the partner sent a file; resolves `skipped` when the evaluation was canceled or ended. */
export async function runPartnerOcr(evaluationId: string): Promise<{ skipped?: boolean; chars?: number }> {
  const row = await openRow(evaluationId);
  if (!row) return { skipped: true };
  if (!row.studentText && row.studentFile?.length) {
    const text = await ocrDocument(row.studentFile, row.studentFileName || "sheet.pdf");
    await row.update({ studentText: text });
    logger.info(`[Partner] ${evaluationId}: ${text.length} chars of student text.`);
    return { chars: text.length };
  }
  return { chars: row.studentText?.length ?? 0 };
}

export async function runPartnerEvaluation(evaluationId: string) {
  const row = await openRow(evaluationId);
  if (!row) return { skipped: true };
  const started = Date.now();
  const res = await axios.post(
    pythonServices.evaluateV1Url(),
    {
      paper: row.paper,
      studentAnswerText: row.studentText || "",
      // The page images: for diagram questions and when the text is weak.
      studentFileBase64: row.studentFile?.length ? row.studentFile.toString("base64") : undefined,
      studentFileName: row.studentFileName || "sheet.pdf",
      answerKeyText: row.answerKeyText || "",
      studentId: row.studentId || "student",
      examId: `partner-${row.keyId}`,
      requestId: row.evaluationId,
    },
    {
      headers: { "Content-Type": "application/json", ...serviceHeaders("eval") },
      timeout: EVAL_TIMEOUT_MS,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );
  await row.update({ status: "succeeded", result: res.data, error: null, errorCode: null, finishedAt: new Date(), studentFile: null });
  logger.info(`[Partner] ${evaluationId} evaluated in ${Math.round((Date.now() - started) / 1000)}s: ${res.data?.summary?.obtainedMarks ?? "?"} marks.`);
  void enqueueWebhook(evaluationId, "evaluation.succeeded");
  return { score: res.data?.summary?.obtainedMarks ?? null };
}

/** The evaluation failed for good: recorded with a code, the sheet dropped, the partner told. */
export async function failPartner(evaluationId: string, stage: "OCR" | "AI", err: any) {
  const message = String(err?.response?.data?.detail || err?.message || err || "The evaluation failed.").slice(0, 2000);
  const errorCode =
    stage === "OCR" ? PARTNER_ERROR_CODES.OCR_FAILED : /\(422\)/.test(message) ? PARTNER_ERROR_CODES.INVALID_PAPER : PARTNER_ERROR_CODES.EVALUATION_FAILED;
  const [count] = await PartnerEvaluation.update(
    { status: "failed", error: message, errorCode, finishedAt: new Date(), studentFile: null },
    { where: { evaluationId, status: { [Op.in]: OPEN } } }
  );
  logger.warn(`[Partner] ${evaluationId} failed at ${stage}: ${message}`);
  if (count) void enqueueWebhook(evaluationId, "evaluation.failed");
}
