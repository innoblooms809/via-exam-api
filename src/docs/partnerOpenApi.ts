// OpenAPI 3.0 description of the partner evaluation API, served at GET /v1/partner/openapi.json.
// Keep it in step with routes/v1/partner/partner.route.ts and services/partner.

const errorBody = {
  type: "object",
  required: ["error", "requestId"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string", example: "validation_failed" },
        message: { type: "string" },
        details: { description: "Per-field problems for validation_failed.", type: "array", items: { type: "object", properties: { path: { type: "string" }, message: { type: "string" } } } },
      },
    },
    requestId: { type: "string", example: "req_9f2c1a7b3d4e5f60" },
  },
};

const errorResponse = (description: string) => ({ description, content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } });

const paperNode: any = {
  type: "object",
  required: ["type"],
  properties: {
    number: { type: "integer", description: "Printed number (top level only); defaults to the position." },
    label: { type: "string", description: "Printed label of a part, e.g. \"(b)\"; defaults to the numbering." },
    sourceId: { type: "string", description: "Your own id, echoed back in the result." },
    type: {
      type: "string",
      enum: ["mcq", "true_false", "fill_in_the_blank", "very_short_answer", "short_answer", "long_answer", "match", "assertion_reason", "diagram", "numerical", "group", "comprehension", "case_study"],
    },
    text: { type: "string" },
    passage: { type: "object", description: "comprehension / case_study: the passage its parts share.", properties: { title: { type: "string" }, text: { type: "string" } } },
    options: { type: "array", items: { type: "string" }, description: "mcq options in order (a), (b), …" },
    assertion: { type: "string" },
    reason: { type: "string" },
    match: { type: "object", properties: { left: { type: "array", items: { type: "string" } }, right: { type: "array", items: { type: "string" } }, headers: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 } } },
    wordLimit: { type: "string" },
    marks: { type: "number", description: "Marks of a part without sub-parts; a parent's marks are computed." },
    hasDiagram: { type: "boolean" },
    numbering: { type: "string", enum: ["alpha", "roman", "numeric", "upper"] },
    attemptAny: { type: "integer", description: "Only the best N parts count." },
    answer: {
      type: "object",
      description: "The key. Objective types with a structured key are marked by rule.",
      properties: {
        text: { type: "string", description: "Model answer." },
        correctOption: { oneOf: [{ type: "integer", minimum: 0 }, { type: "string", example: "b" }] },
        trueFalse: { type: "boolean" },
        matchKey: { type: "array", items: { type: "integer", nullable: true }, description: "For each left row, the index of its right row." },
        acceptedAnswers: { type: "array", items: { type: "string" } },
        keywords: { type: "array", items: { type: "string" } },
        markingScheme: { type: "string" },
      },
    },
    parts: { type: "array", items: { $ref: "#/components/schemas/PaperNode" }, description: "Sub-parts, up to two levels: Q.5 (b) (ii)." },
    or: { $ref: "#/components/schemas/PaperNode", description: "Internal choice: the alternative to this question." },
  },
};

export const partnerOpenApi = {
  openapi: "3.0.3",
  info: {
    title: "ViaExam evaluation API",
    version: "1.0.0",
    description:
      "AI evaluation of handwritten or typed answer sheets against a structured question paper.\n\n" +
      "**Flow:** POST /evaluations (202, queued) → poll GET /evaluations/{id} or receive a webhook → result.\n\n" +
      "**Auth:** `Authorization: Bearer vx_live_…` (or `X-API-Key`). Keys are issued by ViaExam; each has scopes, a rate limit (requests per minute) and a limit on evaluations waiting at once.\n\n" +
      "**Idempotency:** send `Idempotency-Key` on POST /evaluations; the same key with the same body returns the original evaluation (200, `Idempotent-Replayed: true`), with a different body 409.\n\n" +
      "**Webhooks:** `X-ViaExam-Signature: t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(webhook secret, `<t>.<raw body>`). Reject signatures older than 5 minutes. Deliveries are retried for about 2 hours on timeouts, 429 and 5xx; answer 2xx quickly.\n\n" +
      "**Errors:** `{ \"error\": { \"code\", \"message\", \"details\"? }, \"requestId\" }` — quote the request id (also in the X-Request-Id header) to support.",
  },
  servers: [{ url: "/v1/partner" }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", description: "vx_live_<keyId>_<secret>" },
      apiKeyHeader: { type: "apiKey", in: "header", name: "X-API-Key" },
    },
    schemas: {
      Error: errorBody,
      PaperNode: paperNode,
      Paper: {
        type: "object",
        required: ["questions"],
        properties: { schema: { type: "string", enum: ["viaexam.paper/v1"] }, questions: { type: "array", minItems: 1, maxItems: 300, items: { $ref: "#/components/schemas/PaperNode" } } },
      },
      CreateEvaluation: {
        type: "object",
        required: ["paper", "student"],
        properties: {
          paper: { $ref: "#/components/schemas/Paper" },
          student: {
            type: "object",
            description: "The student's answers: OCR-ed text, or the sheet itself (PDF / JPEG / PNG / WebP, up to 10 MB). Send the file too when you have it: its page images are used for diagrams.",
            properties: {
              id: { type: "string", maxLength: 128 },
              answerText: { type: "string" },
              file: { type: "object", required: ["contentBase64"], properties: { name: { type: "string" }, contentBase64: { type: "string", format: "byte" } } },
            },
          },
          answerKeyText: { type: "string", description: "OCR text of an uploaded model answer sheet, for parts without a typed key." },
          externalId: { type: "string", maxLength: 128, description: "Your reference; filterable." },
          metadata: { type: "object", additionalProperties: true, description: "Returned as sent (up to 50 keys)." },
          webhookUrl: { type: "string", format: "uri", description: "Overrides the key's webhook URL for this evaluation. Public https only." },
        },
      },
      Evaluation: {
        type: "object",
        properties: {
          id: { type: "string", example: "pev_3f9a1c0d2b4e6f8a1c3e5d7b" },
          object: { type: "string", enum: ["evaluation"] },
          status: { type: "string", enum: ["queued", "processing", "succeeded", "failed", "canceled"] },
          externalId: { type: "string", nullable: true },
          studentId: { type: "string", nullable: true },
          metadata: { type: "object", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          startedAt: { type: "string", format: "date-time", nullable: true },
          finishedAt: { type: "string", format: "date-time", nullable: true },
          queue: { type: "object", nullable: true, description: "While waiting: the stage and place in line.", properties: { stage: { type: "string" }, position: { type: "integer" } } },
          result: {
            type: "object",
            nullable: true,
            description:
              "On success: `summary` (obtainedMarks, totalMarks, …), `questions` (every marked part: questionId such as Q.5.b.ii, label, parentId, path, " +
              "questionType, marks {obtained, maximum}, status, method (rule_mcq / model …), counted / notCountedReason for attempt-any and OR, needsReview / reviewReasons, feedback), " +
              "`tree` (the question tree with totals) and `orChoices` (the side of each OR the student answered).",
            additionalProperties: true,
          },
          error: { type: "object", nullable: true, properties: { code: { type: "string", enum: ["ocr_failed", "evaluation_failed", "invalid_paper", "unreadable_sheet", "queue_unavailable"] }, message: { type: "string" } } },
          links: { type: "object", properties: { self: { type: "string" } } },
        },
      },
    },
  },
  paths: {
    "/capabilities": {
      get: {
        summary: "What the evaluator understands, and this key's limits",
        responses: { 200: { description: "Question types, structure (sub-parts depth, attempt any, OR, passages), languages and limits." }, 401: errorResponse("Missing or invalid key") },
      },
    },
    "/evaluations": {
      post: {
        summary: "Queue an evaluation",
        parameters: [{ name: "Idempotency-Key", in: "header", required: false, schema: { type: "string", maxLength: 128 } }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/CreateEvaluation" } } } },
        responses: {
          202: { description: "Queued", headers: { Location: { schema: { type: "string" } } }, content: { "application/json": { schema: { $ref: "#/components/schemas/Evaluation" } } } },
          200: { description: "Idempotent replay of an earlier request", content: { "application/json": { schema: { $ref: "#/components/schemas/Evaluation" } } } },
          400: errorResponse("validation_failed, missing_answers, invalid_file, unsafe_file, invalid_webhook_url, invalid_idempotency_key"),
          401: errorResponse("Missing or invalid key"),
          403: errorResponse("insufficient_scope"),
          409: errorResponse("idempotency_conflict"),
          413: errorResponse("file_too_large"),
          415: errorResponse("unsupported_file"),
          429: errorResponse("rate_limited (Retry-After) or queue_full"),
          503: errorResponse("queue_unavailable"),
        },
      },
      get: {
        summary: "List evaluations, newest first",
        parameters: [
          { name: "status", in: "query", schema: { type: "string", enum: ["queued", "processing", "succeeded", "failed", "canceled"] } },
          { name: "externalId", in: "query", schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "nextCursor of the previous page" },
        ],
        responses: {
          200: {
            description: "A page of evaluations (results included).",
            content: { "application/json": { schema: { type: "object", properties: { object: { type: "string" }, data: { type: "array", items: { $ref: "#/components/schemas/Evaluation" } }, hasMore: { type: "boolean" }, nextCursor: { type: "string", nullable: true } } } } },
          },
          401: errorResponse("Missing or invalid key"),
        },
      },
    },
    "/evaluations/{evaluationId}": {
      get: {
        summary: "An evaluation: status, place in the queue, result",
        parameters: [{ name: "evaluationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "The evaluation", content: { "application/json": { schema: { $ref: "#/components/schemas/Evaluation" } } } }, 404: errorResponse("not_found") },
      },
    },
    "/evaluations/{evaluationId}/cancel": {
      post: {
        summary: "Cancel an evaluation that has not started",
        parameters: [{ name: "evaluationId", in: "path", required: true, schema: { type: "string" } }],
        responses: { 200: { description: "Canceled", content: { "application/json": { schema: { $ref: "#/components/schemas/Evaluation" } } } }, 404: errorResponse("not_found"), 409: errorResponse("not_cancelable") },
      },
    },
  },
  "x-webhooks": {
    "evaluation.succeeded": { description: "Body: { id, type, createdAt, data: Evaluation }" },
    "evaluation.failed": { description: "Body: { id, type, createdAt, data: Evaluation }" },
  },
};
