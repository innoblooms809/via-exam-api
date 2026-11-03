'use strict';

/**
 * The partner evaluation API (/v1/partner):
 *   - viaexam_partner_api_keys: partner keys (only a SHA-256 of each secret; the webhook
 *     signing secret sealed), scopes and limits;
 *   - viaexam_partner_evaluations: evaluation requests, their status and result.
 * The API also creates these on boot (sequelize sync); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate:partner-api
 */

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`CREATE TABLE IF NOT EXISTS "viaexam_partner_api_keys" (
      "id" SERIAL PRIMARY KEY,
      "keyId" VARCHAR(32) NOT NULL UNIQUE,
      "name" VARCHAR(120) NOT NULL,
      "keyHash" VARCHAR(64) NOT NULL,
      "scopes" JSONB NOT NULL DEFAULT '["evaluations:write","evaluations:read"]',
      "status" VARCHAR(16) NOT NULL DEFAULT 'active',
      "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60,
      "maxQueued" INTEGER NOT NULL DEFAULT 200,
      "webhookUrl" TEXT,
      "webhookSecretSealed" TEXT NOT NULL,
      "createdBy" VARCHAR(255),
      "lastUsedAt" TIMESTAMP WITH TIME ZONE,
      "revokedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);
    await q(`CREATE TABLE IF NOT EXISTS "viaexam_partner_evaluations" (
      "id" SERIAL PRIMARY KEY,
      "evaluationId" VARCHAR(40) NOT NULL UNIQUE,
      "keyId" VARCHAR(32) NOT NULL,
      "externalId" VARCHAR(128),
      "idempotencyKey" VARCHAR(128),
      "requestHash" VARCHAR(64) NOT NULL,
      "status" VARCHAR(16) NOT NULL DEFAULT 'queued',
      "paper" JSONB NOT NULL,
      "answerKeyText" TEXT,
      "studentText" TEXT,
      "studentFile" BYTEA,
      "studentFileName" VARCHAR(255),
      "studentId" VARCHAR(128),
      "metadata" JSONB,
      "webhookUrl" TEXT,
      "result" JSONB,
      "error" TEXT,
      "errorCode" VARCHAR(40),
      "startedAt" TIMESTAMP WITH TIME ZONE,
      "finishedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    )`);
    await q(`CREATE INDEX IF NOT EXISTS "viaexam_partner_evaluations_key_id_created_at" ON "viaexam_partner_evaluations" ("keyId", "createdAt")`);
    await q(`CREATE INDEX IF NOT EXISTS "viaexam_partner_evaluations_key_id_status" ON "viaexam_partner_evaluations" ("keyId", "status")`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS "viaexam_partner_evaluations_idempotency" ON "viaexam_partner_evaluations" ("keyId", "idempotencyKey")`);
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`DROP TABLE IF EXISTS "viaexam_partner_evaluations"`);
    await q(`DROP TABLE IF EXISTS "viaexam_partner_api_keys"`);
  },
};
