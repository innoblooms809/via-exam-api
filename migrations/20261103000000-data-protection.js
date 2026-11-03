'use strict';

/**
 * Sensitive data at rest (src/utils/dataProtection.ts):
 *   - columns that now hold AES-256-GCM ciphertext become TEXT (ciphertext is longer than the
 *     value): answer sheets' file public id, profile photo paths, Aadhaar numbers;
 *   - viaexam_password_resets.attempts: wrong codes tried against an OTP (it is burned at 5).
 * Existing values are encrypted in the background by the "encrypt-sensitive-data" maintenance
 * task, not here. The API also applies these changes on boot (db/connect.ts); this is for
 * databases managed by migrations only.
 *
 *   npm run db:migrate:data-protection
 */

const TO_TEXT = [
  ['viaexam_answer_sheets', 'filePublicId'],
  ['viaexam_users', 'profileUrl'],
  ['viaexam_teacher_profiles', 'profileUrl'],
  ['viaexam_scanner_profiles', 'profileUrl'],
  ['viaexam_scanner_profiles', 'aadhar'],
  ['viaexam_student_profiles', 'profileUrl'],
  ['viaexam_student_profiles', 'aadhar'],
];

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    // varchar → text keeps the data and doesn't rewrite the table.
    for (const [table, column] of TO_TEXT) await q(`ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE TEXT`);
    await q(`ALTER TABLE "viaexam_password_resets" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0`);
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    await q(`ALTER TABLE "viaexam_password_resets" DROP COLUMN IF EXISTS "attempts"`);
    // The columns stay TEXT: encrypted values don't fit VARCHAR(255).
  },
};
