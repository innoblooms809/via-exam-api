'use strict';

/**
 * Recheck claims: a student's request now says what kind of marking concern it is
 * (category) and which questions it is about (questions, JSONB; null = the whole paper),
 * and keeps the words of the final decision (decisionNote: the admin's reason when it is
 * turned down, the evaluator's remark when it is completed).
 * The API also adds these columns on boot (db/connect.ts); this is for databases managed
 * by migrations only.
 *
 *   npm run db:migrate:recheck-claims
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "viaexam_recheck_requests" ADD COLUMN IF NOT EXISTS "category" VARCHAR(40), ADD COLUMN IF NOT EXISTS "questions" JSONB, ADD COLUMN IF NOT EXISTS "decisionNote" TEXT`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "viaexam_recheck_requests" DROP COLUMN IF EXISTS "category", DROP COLUMN IF EXISTS "questions", DROP COLUMN IF EXISTS "decisionNote"`
    );
  },
};
