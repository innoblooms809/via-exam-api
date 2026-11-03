'use strict';

/**
 * AI evaluation through the job queue (BullMQ on PostgreSQL):
 *   - viaexam_ai_evaluations.queuedAt / startedAt / finishedAt: the current run's timeline;
 *   - viaexam_ai_evaluations.runCount: runs queued for the sheet (re-runs and automatic retries);
 *   - viaexam_ai_evaluations.failureKind: "transient" (a service was down; retried automatically)
 *     or "permanent";
 *   - viaexam_ai_evaluations.resultTree: the evaluator's question tree with totals (sub-parts,
 *     OR, attempt any N).
 * BullMQ's own tables live in the "bullmq" schema and are created by the API / worker on start.
 * The API also applies these columns on boot (db/connect.ts); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate:evaluation-queue
 */

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(
      `ALTER TABLE "viaexam_ai_evaluations"
         ADD COLUMN IF NOT EXISTS "resultTree" JSONB,
         ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN IF NOT EXISTS "runCount" INTEGER NOT NULL DEFAULT 0,
         ADD COLUMN IF NOT EXISTS "failureKind" VARCHAR(16)`
    );
    await q(
      `CREATE INDEX IF NOT EXISTS "viaexam_ai_evaluations_status_updated_idx" ON "viaexam_ai_evaluations" ("status", "updatedAt") WHERE "status" IN ('Pending', 'Failed')`
    );
    await q(
      `CREATE INDEX IF NOT EXISTS "viaexam_answer_sheets_unchecked_idx" ON "viaexam_answer_sheets" ("createdAt") WHERE "qualityFlag" IS NULL AND "isDeleted" = false`
    );
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`DROP INDEX IF EXISTS "viaexam_answer_sheets_unchecked_idx"`);
    await q(`DROP INDEX IF EXISTS "viaexam_ai_evaluations_status_updated_idx"`);
    await q(
      `ALTER TABLE "viaexam_ai_evaluations"
         DROP COLUMN IF EXISTS "resultTree",
         DROP COLUMN IF EXISTS "queuedAt",
         DROP COLUMN IF EXISTS "startedAt",
         DROP COLUMN IF EXISTS "finishedAt",
         DROP COLUMN IF EXISTS "runCount",
         DROP COLUMN IF EXISTS "failureKind"`
    );
  },
};
