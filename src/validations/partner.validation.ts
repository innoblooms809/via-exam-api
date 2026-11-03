import Joi from "joi";
import { PARTNER_SCOPES } from "../models/PartnerApi.model";

const shortText = Joi.string().trim().max(128);

/** POST /v1/partner/evaluations */
export const createEvaluationSchema = Joi.object({
  // Schema "viaexam.paper/v1": the evaluator validates the tree itself and answers 422 (invalid_paper).
  paper: Joi.object({
    schema: Joi.string().valid("viaexam.paper/v1"),
    questions: Joi.array().items(Joi.object().unknown(true)).min(1).max(300).required(),
  })
    .unknown(true)
    .required(),
  student: Joi.object({
    id: shortText,
    answerText: Joi.string().max(500_000).allow(""),
    file: Joi.object({
      name: Joi.string().trim().max(255),
      // 10 MB as base64 (plus a data: prefix).
      contentBase64: Joi.string().max(14_100_000).required(),
    }),
  })
    .or("answerText", "file")
    .required(),
  answerKeyText: Joi.string().max(500_000).allow(""),
  externalId: shortText,
  metadata: Joi.object().max(50).unknown(true),
  webhookUrl: Joi.string().uri({ scheme: ["https", "http"] }).max(2048),
});

export const listEvaluationsSchema = Joi.object({
  status: Joi.string().valid("queued", "processing", "succeeded", "failed", "canceled"),
  externalId: shortText,
  limit: Joi.number().integer().min(1).max(100),
  cursor: Joi.string().max(64),
});

export const evaluationIdSchema = Joi.string().pattern(/^pev_[a-f0-9]{24}$/).required();

/** Super admin: POST /v1/partner-keys and PATCH /v1/partner-keys/:keyId */
export const createKeySchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  scopes: Joi.array().items(Joi.string().valid(...PARTNER_SCOPES)).min(1).unique(),
  rateLimitPerMinute: Joi.number().integer().min(1).max(6000),
  maxQueued: Joi.number().integer().min(1).max(10000),
  webhookUrl: Joi.string().uri({ scheme: ["https", "http"] }).max(2048).allow(null),
});

export const updateKeySchema = createKeySchema.fork(["name"], (s) => s.optional()).min(1);
