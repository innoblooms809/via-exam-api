'use strict';

/**
 * Recheck policy:
 *   - viaexam_institute_settings.recheckPolicy ({ enabled, days }): whether students can claim a
 *     recheck, and for how many days after an exam's results are published (on, 6 days when not set);
 *   - viaexam_student_results.recheckClosesAt, each published result's deadline, set when it is
 *     published (null on older results: they use the school's days counted from publishedAt).
 * The API also applies these on boot (db/connect.ts); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate
 */

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE "viaexam_institute_settings" ADD COLUMN IF NOT EXISTS "recheckPolicy" JSONB`);
    await q(`ALTER TABLE "viaexam_student_results" ADD COLUMN IF NOT EXISTS "recheckClosesAt" TIMESTAMP WITH TIME ZONE`);
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE "viaexam_student_results" DROP COLUMN IF EXISTS "recheckClosesAt"`);
    await q(`ALTER TABLE "viaexam_institute_settings" DROP COLUMN IF EXISTS "recheckPolicy"`);
  },
};
