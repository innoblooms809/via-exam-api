/**
 * Partner evaluation requests: create (idempotent), read, list, cancel.
 *
 * A request is queued, not run in the HTTP call: the answer is 202 with the evaluation's id,
 * and the partner either polls GET /evaluations/:id or receives a webhook. Each key may keep
 * `maxQueued` evaluations waiting or running at once (429 beyond).
 */

import crypto from "crypto";
import { Op } from "sequelize";
import axios from "axios";
import httpStatus from "http-status";
import { PartnerEvaluation, type PartnerApiKey } from "../../models/PartnerApi.model";
import { pythonServices, serviceHeaders } from "../../config/pythonServices";
import { ANSWER_SHEET_LIMITS } from "../../config/uploadLimits";
import { findPdfActiveContent, sniffFileType } from "../../utils/fileSignature";
import { PAPER_SCHEMA } from "../../utils/evaluationPaper";
import { partnerQueuePlace, queuePartnerEvaluation, unqueuePartnerEvaluation } from "../evaluation/pipeline6.service";
import { assertPublicUrl } from "./partnerWebhooks";
import { toResource } from "./partnerResource";

export class PartnerApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}

export interface CreateEvaluationBody {
  paper: { schema?: string; questions: unknown[] };
  student: { id?: string; answerText?: string; file?: { name?: string; contentBase64: string } };
  answerKeyText?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
  webhookUrl?: string;
}

const SHEET_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
const newEvaluationId = () => `pev_${crypto.randomBytes(12).toString("hex")}`;

/** The student's file: decoded, within the size limit, really a PDF / image, no active PDF content. */
function decodeSheet(file: { name?: string; contentBase64: string }) {
  const raw = file.contentBase64.includes(",") && file.contentBase64.startsWith("data:") ? file.contentBase64.split(",", 2)[1] : file.contentBase64;
  const buffer = Buffer.from(raw, "base64");
  if (!buffer.length) throw new PartnerApiError(httpStatus.BAD_REQUEST, "invalid_file", "student.file.contentBase64 is empty or not base64.");
  if (buffer.length > ANSWER_SHEET_LIMITS.maxFileBytes) {
    throw new PartnerApiError(httpStatus.REQUEST_ENTITY_TOO_LARGE, "file_too_large", `The sheet is larger than ${ANSWER_SHEET_LIMITS.maxFileBytes / 1024 / 1024} MB.`);
  }
  const type = sniffFileType(buffer.subarray(0, 1024));
  if (!type || !SHEET_TYPES.has(type.mime)) {
    throw new PartnerApiError(httpStatus.UNSUPPORTED_MEDIA_TYPE, "unsupported_file", "The sheet must be a PDF, JPEG, PNG or WebP file.");
  }
  if (type.mime === "application/pdf") {
    const unsafe = findPdfActiveContent(buffer);
    if (unsafe) throw new PartnerApiError(httpStatus.BAD_REQUEST, "unsafe_file", unsafe);
  }
  const base = String(file.name || "sheet").replace(/[^\w.-]+/g, "_").replace(/\.[^.]*$/, "").slice(0, 100) || "sheet";
  return { buffer, fileName: `${base}${type.ext}` };
}

export async function createEvaluation(key: PartnerApiKey, body: CreateEvaluationBody, idempotencyKey: string | null) {
  const requestHash = crypto.createHash("sha256").update(JSON.stringify(body)).digest("hex");

  if (idempotencyKey) {
    const existing = await PartnerEvaluation.findOne({ where: { keyId: key.keyId, idempotencyKey } });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new PartnerApiError(httpStatus.CONFLICT, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
      }
      return { resource: toResource(existing), replayed: true };
    }
  }

  const open = await PartnerEvaluation.count({ where: { keyId: key.keyId, status: { [Op.in]: ["queued", "processing"] } } });
  if (open >= key.maxQueued) {
    throw new PartnerApiError(httpStatus.TOO_MANY_REQUESTS, "queue_full", `This key already has ${open} evaluations waiting or running (limit ${key.maxQueued}). Wait for some to finish.`);
  }

  const webhookUrl = body.webhookUrl ?? key.webhookUrl ?? null;
  if (webhookUrl) {
    try {
      await assertPublicUrl(webhookUrl);
    } catch (err: any) {
      throw new PartnerApiError(httpStatus.BAD_REQUEST, "invalid_webhook_url", err?.message || "The webhook URL is not allowed.");
    }
  }

  const sheet = body.student.file ? decodeSheet(body.student.file) : null;
  const studentText = (body.student.answerText ?? "").trim();
  if (!studentText && !sheet) {
    throw new PartnerApiError(httpStatus.BAD_REQUEST, "missing_answers", "Send student.answerText or student.file.");
  }

  let row: PartnerEvaluation;
  try {
    row = await PartnerEvaluation.create({
      evaluationId: newEvaluationId(),
      keyId: key.keyId,
      externalId: body.externalId ?? null,
      idempotencyKey,
      requestHash,
      status: "queued",
      paper: { ...body.paper, schema: body.paper.schema || PAPER_SCHEMA },
      answerKeyText: body.answerKeyText ?? null,
      studentText: studentText || null,
      studentFile: sheet?.buffer ?? null,
      studentFileName: sheet?.fileName ?? null,
      studentId: body.student.id ?? null,
      metadata: body.metadata ?? null,
      webhookUrl,
    });
  } catch (err: any) {
    // The same Idempotency-Key sent twice at once: the other request created it.
    if (err?.name === "SequelizeUniqueConstraintError" && idempotencyKey) {
      const existing = await PartnerEvaluation.findOne({ where: { keyId: key.keyId, idempotencyKey } });
      if (existing && existing.requestHash === requestHash) return { resource: toResource(existing), replayed: true };
      throw new PartnerApiError(httpStatus.CONFLICT, "idempotency_conflict", "This Idempotency-Key was already used with a different request.");
    }
    throw err;
  }

  try {
    await queuePartnerEvaluation(row.evaluationId, !studentText);
  } catch (err: any) {
    await row.update({ status: "failed", error: "The evaluation could not be queued. Try again.", errorCode: "queue_unavailable", finishedAt: new Date(), studentFile: null });
    throw new PartnerApiError(httpStatus.SERVICE_UNAVAILABLE, "queue_unavailable", "The evaluation queue is unavailable. Try again shortly.");
  }
  return { resource: toResource(row), replayed: false };
}

const ownRow = async (key: PartnerApiKey, evaluationId: string) => {
  const row = await PartnerEvaluation.findOne({ where: { evaluationId, keyId: key.keyId } });
  if (!row) throw new PartnerApiError(httpStatus.NOT_FOUND, "not_found", "No evaluation with this id.");
  return row;
};

export async function getEvaluation(key: PartnerApiKey, evaluationId: string) {
  const row = await ownRow(key, evaluationId);
  const resource: Record<string, unknown> = toResource(row);
  if (row.status === "queued" || row.status === "processing") resource.queue = await partnerQueuePlace(row.evaluationId).catch(() => null);
  return resource;
}

/** Newest first; `cursor` is the `nextCursor` of the previous page. */
export async function listEvaluations(key: PartnerApiKey, query: { status?: string; externalId?: string; limit?: number; cursor?: string }) {
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const where: any = { keyId: key.keyId };
  if (query.status) where.status = query.status;
  if (query.externalId) where.externalId = query.externalId;
  if (query.cursor) {
    const id = Number(Buffer.from(query.cursor, "base64url").toString("utf8"));
    if (!Number.isFinite(id)) throw new PartnerApiError(httpStatus.BAD_REQUEST, "invalid_cursor", "The cursor is not valid.");
    where.id = { [Op.lt]: id };
  }
  const rows = await PartnerEvaluation.findAll({
    where,
    order: [["id", "DESC"]],
    limit: limit + 1,
    attributes: { exclude: ["studentFile", "studentText", "answerKeyText", "paper"] },
  });
  const page = rows.slice(0, limit);
  return {
    object: "list",
    data: page.map(toResource),
    hasMore: rows.length > limit,
    nextCursor: rows.length > limit ? Buffer.from(String(page[page.length - 1].id)).toString("base64url") : null,
  };
}

export async function cancelEvaluation(key: PartnerApiKey, evaluationId: string) {
  const row = await ownRow(key, evaluationId);
  if (row.status !== "queued" && row.status !== "processing") {
    throw new PartnerApiError(httpStatus.CONFLICT, "not_cancelable", `The evaluation is already ${row.status}.`);
  }
  if (!(await unqueuePartnerEvaluation(row.evaluationId))) {
    throw new PartnerApiError(httpStatus.CONFLICT, "not_cancelable", "The evaluation is being processed and can no longer be canceled.");
  }
  await row.update({ status: "canceled", finishedAt: new Date(), studentFile: null });
  return toResource(row);
}

/** What the evaluator understands (question types, structure, limits), plus this API's limits. */
export async function capabilities(key: PartnerApiKey) {
  let evaluator: unknown = null;
  try {
    evaluator = (await axios.get(pythonServices.capabilitiesUrl(), { timeout: 5000, headers: serviceHeaders("eval") })).data;
  } catch {
    evaluator = null; // the evaluator is down; the API still answers with its own limits
  }
  return {
    paperSchema: PAPER_SCHEMA,
    evaluator,
    limits: {
      maxFileBytes: ANSWER_SHEET_LIMITS.maxFileBytes,
      fileTypes: [...SHEET_TYPES],
      rateLimitPerMinute: key.rateLimitPerMinute,
      maxQueued: key.maxQueued,
    },
    scopes: key.scopes,
  };
}

export default { createEvaluation, getEvaluation, listEvaluations, cancelEvaluation, capabilities };
