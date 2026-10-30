'use strict';

/**
 * Indexes for one person's page (services/dashboard/person.service): every list there
 * is filtered by the person (teacher, scanner, student or uploader) and paged newest
 * first, so each source table gets an index on the person column.
 *
 *   npm run db:migrate:person-page
 *
 * Idempotent (IF NOT EXISTS) and built CONCURRENTLY so writes are never blocked; that
 * is why each statement runs on its own, outside a transaction.
 */

const INDEXES = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_teacher_session_idx" ON "viaexam_exams" ("teacherId", "sessionId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_class_section_idx" ON "viaexam_exams" ("classId", "sectionId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_activity_logs_user_event_created_idx" ON "viaexam_activity_logs" ("userId", "eventType", "createdAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_uploader_created_idx" ON "viaexam_answer_sheets" ("uploadedBy", "createdAt" DESC) WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_class_roll_idx" ON "viaexam_answer_sheets" ("classId", "rollNo") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_recheck_assignments_teacher_idx" ON "viaexam_recheck_assignments" ("teacherId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_recheck_requests_student_idx" ON "viaexam_recheck_requests" ("studentId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exam_attendance_student_idx" ON "viaexam_exam_attendance" ("studentId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_ai_evaluations_student_idx" ON "viaexam_ai_evaluations" ("studentId")`,
];

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    for (const sql of INDEXES) {
      // An index on a table this database doesn't have is skipped, not fatal.
      const table = sql.match(/ ON "([^"]+)"/)[1];
      const [[found]] = await q(`SELECT to_regclass('public."${table}"') IS NOT NULL AS ok`);
      if (found.ok) await q(sql);
      // eslint-disable-next-line no-console
      else console.warn(`[migration] table ${table} not found; skipped one index.`);
    }
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    // The uploader index also belongs to 20261010000000-exam-workflow-and-indexes; keep it.
    for (const sql of INDEXES.filter((s) => !s.includes("uploader_created_idx"))) {
      await q(`DROP INDEX CONCURRENTLY IF EXISTS "${sql.match(/IF NOT EXISTS "([^"]+)"/)[1]}"`);
    }
  },
};
