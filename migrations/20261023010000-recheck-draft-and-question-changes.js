'use strict';

/**
 * Recheck re-evaluation and question-wise marks history:
 *   - viaexam_recheck_assignments.draft: the recheck teacher's re-evaluation (AI run and
 *     question-wise marks), kept apart from the live evaluation until the admin approves;
 *   - viaexam_recheck_assignments.changes: what the decision changes, question by question;
 *   - viaexam_marks_audit.details: the questions whose marks changed, on every change.
 * The API also applies these on boot (db/connect.ts); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate:recheck-draft
 */

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE "viaexam_recheck_assignments" ADD COLUMN IF NOT EXISTS "draft" JSONB, ADD COLUMN IF NOT EXISTS "changes" JSONB`);
    await q(`ALTER TABLE "viaexam_marks_audit" ADD COLUMN IF NOT EXISTS "details" JSONB`);
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE "viaexam_recheck_assignments" DROP COLUMN IF EXISTS "draft", DROP COLUMN IF EXISTS "changes"`);
    await q(`ALTER TABLE "viaexam_marks_audit" DROP COLUMN IF EXISTS "details"`);
  },
};
