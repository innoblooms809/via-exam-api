'use strict';

/**
 * Scan quality of uploaded answer sheets:
 *   - viaexam_answer_sheets.qualityFlag (ok / warn / low / unchecked; null until checked)
 *     and qualityReport (per-page DPI, sharpness, contrast);
 *   - viaexam_institute_settings.scanQuality, the thresholds a school flags sheets by.
 * The API also applies these on boot (db/connect.ts); this is for databases managed by
 * migrations only.
 *
 *   npm run db:migrate:scan-quality
 */

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE "viaexam_answer_sheets" ADD COLUMN IF NOT EXISTS "qualityFlag" VARCHAR(16), ADD COLUMN IF NOT EXISTS "qualityReport" JSONB`);
    await q(`ALTER TABLE "viaexam_institute_settings" ADD COLUMN IF NOT EXISTS "scanQuality" JSONB`);
    await q(
      `CREATE INDEX IF NOT EXISTS "viaexam_answer_sheets_exam_quality_idx" ON "viaexam_answer_sheets" ("examId", "qualityFlag") WHERE "isDeleted" = false`
    );
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`DROP INDEX IF EXISTS "viaexam_answer_sheets_exam_quality_idx"`);
    await q(`ALTER TABLE "viaexam_answer_sheets" DROP COLUMN IF EXISTS "qualityFlag", DROP COLUMN IF EXISTS "qualityReport"`);
    await q(`ALTER TABLE "viaexam_institute_settings" DROP COLUMN IF EXISTS "scanQuality"`);
  },
};
