/**
 * How the partner API shows an evaluation (responses and webhook payloads alike), and its
 * error codes. Kept free of other services so the queue processors and webhooks can use it.
 */

import type { PartnerEvaluation } from "../../models/PartnerApi.model";

/** Machine-readable reasons an evaluation failed. */
export const PARTNER_ERROR_CODES = {
  OCR_FAILED: "ocr_failed",
  EVALUATION_FAILED: "evaluation_failed",
  INVALID_PAPER: "invalid_paper",
  UNREADABLE_SHEET: "unreadable_sheet",
} as const;

export const evaluationPath = (evaluationId: string) => `/v1/partner/evaluations/${evaluationId}`;

export function toResource(row: PartnerEvaluation) {
  return {
    id: row.evaluationId,
    object: "evaluation",
    status: row.status,
    externalId: row.externalId,
    studentId: row.studentId,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    // The evaluator's full result: summary, every part (Q.5.b.ii) with marks and feedback, the
    // question tree with totals (attempt any N, OR) and which OR side was answered.
    result: row.status === "succeeded" ? row.result : null,
    error: row.status === "failed" ? { code: row.errorCode ?? PARTNER_ERROR_CODES.EVALUATION_FAILED, message: row.error ?? "The evaluation failed." } : null,
    links: { self: evaluationPath(row.evaluationId) },
  };
}
