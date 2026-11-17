'use strict';

/**
 * Date sheets: draft → publish → reschedule.
 *   - viaexam_academic_calendar.status: "draft" (only the school admin sees the paper) or
 *     "published" (teachers, scanner staff and students see it). Existing rows and events
 *     other than date-sheet papers are "published".
 *   - publishedAt / publishedBy: when and by whom it was published.
 *   - changeLog: every reschedule or removal after publishing (from / to, reason, who, when).
 * The API also applies these on boot (db/connect.ts); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate
 */

module.exports = {
  up: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "viaexam_academic_calendar" ADD COLUMN IF NOT EXISTS "status" VARCHAR(16) NOT NULL DEFAULT 'published', ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "publishedBy" VARCHAR(255), ADD COLUMN IF NOT EXISTS "changeLog" JSONB`
    );
  },

  down: async (queryInterface) => {
    await queryInterface.sequelize.query(
      `ALTER TABLE "viaexam_academic_calendar" DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "publishedAt", DROP COLUMN IF EXISTS "publishedBy", DROP COLUMN IF EXISTS "changeLog"`
    );
  },
};
