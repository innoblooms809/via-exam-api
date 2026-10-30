'use strict';

/**
 * Recheck decisions are approved by the admin before they reach the result:
 *   - viaexam_recheck_requests.status gets 'Awaiting Approval' (the teacher has decided);
 *   - viaexam_recheck_assignments keeps who approved it and when, and the last note the
 *     admin sent back with (returnNote, returnedAt);
 *   - viaexam_marks_audit keeps who approved a change of marks (approvedBy).
 * The API also applies these on boot (db/connect.ts); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate:recheck-approval
 */

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TYPE "enum_viaexam_recheck_requests_status" ADD VALUE IF NOT EXISTS 'Awaiting Approval' AFTER 'Under Review'`);
    await q(
      `ALTER TABLE "viaexam_recheck_assignments" ADD COLUMN IF NOT EXISTS "approvedBy" VARCHAR(255), ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "returnNote" TEXT, ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP WITH TIME ZONE`
    );
    await q(`ALTER TABLE "viaexam_marks_audit" ADD COLUMN IF NOT EXISTS "approvedBy" VARCHAR(255)`);
  },

  // Postgres can't drop an enum value; requests still awaiting approval go back to their teacher.
  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`UPDATE "viaexam_recheck_requests" SET status = 'Under Review' WHERE status = 'Awaiting Approval'`);
    await q(
      `ALTER TABLE "viaexam_recheck_assignments" DROP COLUMN IF EXISTS "approvedBy", DROP COLUMN IF EXISTS "approvedAt", DROP COLUMN IF EXISTS "returnNote", DROP COLUMN IF EXISTS "returnedAt"`
    );
    await q(`ALTER TABLE "viaexam_marks_audit" DROP COLUMN IF EXISTS "approvedBy"`);
  },
};
