import { Response } from "express";
import httpStatus from "http-status";
import type Joi from "joi";
import logger from "../../config/logger";
import { sendPartnerError, type PartnerRequest } from "../../middlewares/partnerAuth";
import PartnerEvaluationService, { PartnerApiError } from "../../services/partner/partnerEvaluation.service";
import PartnerKeysService from "../../services/partner/partnerKeys.service";
import { createEvaluationSchema, createKeySchema, evaluationIdSchema, listEvaluationsSchema, updateKeySchema } from "../../validations/partner.validation";
import { partnerOpenApi } from "../../docs/partnerOpenApi";

// ─── Partner API (API key) ──────────────────────────────────────────────────────

const handle = (fn: (req: PartnerRequest, res: Response) => Promise<unknown>) => async (req: PartnerRequest, res: Response) => {
  try {
    await fn(req, res);
  } catch (err: any) {
    if (err instanceof PartnerApiError) return sendPartnerError(req, res, err.status, err.code, err.message, err.details);
    logger.error(`[Partner] ${req.method} ${req.originalUrl} (${req.requestId}) failed: ${err?.stack || err}`);
    return sendPartnerError(req, res, httpStatus.INTERNAL_SERVER_ERROR, "internal_error", "Something went wrong. Quote the request id if you contact support.");
  }
};

const checked = <T>(schema: Joi.Schema, value: unknown): T => {
  const { value: valid, error } = schema.validate(value, { abortEarly: false });
  if (error) {
    throw new PartnerApiError(
      httpStatus.BAD_REQUEST,
      "validation_failed",
      "The request is invalid.",
      error.details.map((d) => ({ path: d.path.join("."), message: d.message.replace(/"/g, "'") }))
    );
  }
  return valid as T;
};

const evaluationIdOf = (req: PartnerRequest) => {
  const { error } = evaluationIdSchema.validate(req.params.evaluationId);
  if (error) throw new PartnerApiError(httpStatus.NOT_FOUND, "not_found", "No evaluation with this id.");
  return req.params.evaluationId;
};

const createEvaluation = handle(async (req, res) => {
  const idempotencyKey = req.header("idempotency-key") ?? null;
  if (idempotencyKey !== null && !/^[\x21-\x7e]{1,128}$/.test(idempotencyKey)) {
    throw new PartnerApiError(httpStatus.BAD_REQUEST, "invalid_idempotency_key", "Idempotency-Key must be 1–128 printable characters.");
  }
  const body = checked<any>(createEvaluationSchema, req.body);
  const { resource, replayed } = await PartnerEvaluationService.createEvaluation(req.partnerKey!, body, idempotencyKey);
  res.setHeader("Location", resource.links.self);
  if (replayed) res.setHeader("Idempotent-Replayed", "true");
  res.status(replayed ? httpStatus.OK : httpStatus.ACCEPTED).json(resource);
});

const getEvaluation = handle(async (req, res) => {
  res.json(await PartnerEvaluationService.getEvaluation(req.partnerKey!, evaluationIdOf(req)));
});

const listEvaluations = handle(async (req, res) => {
  res.json(await PartnerEvaluationService.listEvaluations(req.partnerKey!, checked<any>(listEvaluationsSchema, req.query)));
});

const cancelEvaluation = handle(async (req, res) => {
  res.json(await PartnerEvaluationService.cancelEvaluation(req.partnerKey!, evaluationIdOf(req)));
});

const capabilities = handle(async (req, res) => {
  res.json(await PartnerEvaluationService.capabilities(req.partnerKey!));
});

const openApi = (_req: PartnerRequest, res: Response) => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(partnerOpenApi);
};

// ─── Key management (super admin, JWT) ─────────────────────────────────────────

const adminError = (res: Response, err: any) => {
  const status = err?.status || err?.statusCode || httpStatus.BAD_REQUEST;
  return res.status(status).json({ error: true, statusCode: status, message: err?.message || "Request failed." });
};

const adminValidate = <T>(schema: Joi.Schema, value: unknown): T => {
  const { value: valid, error } = schema.validate(value, { abortEarly: false });
  if (error) throw Object.assign(new Error(error.details.map((d) => d.message).join(", ")), { status: httpStatus.BAD_REQUEST });
  return valid as T;
};

const createKey = async (req: any, res: Response) => {
  try {
    const body = adminValidate<any>(createKeySchema, req.body);
    const data = await PartnerKeysService.createKey({ ...body, createdBy: req.viaExamUser?.userId ?? null });
    return res.status(httpStatus.CREATED).json({
      error: false,
      statusCode: httpStatus.CREATED,
      message: "API key created. Copy the key and the webhook secret now: they are not shown again.",
      data,
    });
  } catch (err) {
    return adminError(res, err);
  }
};

const listKeys = async (_req: any, res: Response) => {
  try {
    return res.json({ error: false, statusCode: httpStatus.OK, message: "API keys.", data: await PartnerKeysService.listKeys() });
  } catch (err) {
    return adminError(res, err);
  }
};

const updateKey = async (req: any, res: Response) => {
  try {
    const data = await PartnerKeysService.updateKey(req.params.keyId, adminValidate<any>(updateKeySchema, req.body));
    if (!data) return res.status(httpStatus.NOT_FOUND).json({ error: true, statusCode: httpStatus.NOT_FOUND, message: "API key not found." });
    return res.json({ error: false, statusCode: httpStatus.OK, message: "API key updated.", data });
  } catch (err) {
    return adminError(res, err);
  }
};

const revokeKey = async (req: any, res: Response) => {
  try {
    const data = await PartnerKeysService.revokeKey(req.params.keyId);
    if (!data) return res.status(httpStatus.NOT_FOUND).json({ error: true, statusCode: httpStatus.NOT_FOUND, message: "API key not found." });
    return res.json({ error: false, statusCode: httpStatus.OK, message: "API key revoked. It stops working within 30 seconds.", data });
  } catch (err) {
    return adminError(res, err);
  }
};

const rotateWebhookSecret = async (req: any, res: Response) => {
  try {
    const data = await PartnerKeysService.rotateWebhookSecret(req.params.keyId);
    if (!data) return res.status(httpStatus.NOT_FOUND).json({ error: true, statusCode: httpStatus.NOT_FOUND, message: "API key not found." });
    return res.json({ error: false, statusCode: httpStatus.OK, message: "Webhook secret rotated. Copy it now: it is not shown again.", data });
  } catch (err) {
    return adminError(res, err);
  }
};

export default {
  createEvaluation,
  getEvaluation,
  listEvaluations,
  cancelEvaluation,
  capabilities,
  openApi,
  createKey,
  listKeys,
  updateKey,
  revokeKey,
  rotateWebhookSecret,
};
