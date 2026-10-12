'use strict';

/**
 * Exam workflow tables + indexes for the hot read paths.
 *
 * Run ONLY this migration (older ones were applied by hand and are not in
 * SequelizeMeta):
 *
 *   npm run db:migrate:workflow
 *
 * Everything is idempotent (IF NOT EXISTS), so it is safe to run again and safe
 * to run after the API has already started once (sequelize.sync creates the
 * new tables on boot with the same names and indexes).
 *
 * Indexes are built CONCURRENTLY so writes are never blocked; that is why each
 * statement is sent on its own and the migration is not wrapped in a
 * transaction (Postgres refuses CONCURRENTLY inside one).
 */

const TABLES = [
  `CREATE TABLE IF NOT EXISTS "viaexam_exam_scanner_assignments" (
    "id" SERIAL PRIMARY KEY,
    "assignmentId" VARCHAR(32) NOT NULL UNIQUE,
    "instituteId" VARCHAR(255) NOT NULL,
    "examId" VARCHAR(255) NOT NULL,
    "scannerId" VARCHAR(255) NOT NULL,
    "assignedBy" VARCHAR(255) NOT NULL,
    "note" TEXT,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ASSIGNED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "completedBy" VARCHAR(255),
    "unassignedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "viaexam_exam_attendance" (
    "id" SERIAL PRIMARY KEY,
    "attendanceId" VARCHAR(32) NOT NULL UNIQUE,
    "instituteId" VARCHAR(255) NOT NULL,
    "examId" VARCHAR(255) NOT NULL,
    "studentId" VARCHAR(255) NOT NULL,
    "rollNo" VARCHAR(32) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "markedBy" VARCHAR(255) NOT NULL,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "viaexam_student_results" (
    "id" SERIAL PRIMARY KEY,
    "resultId" VARCHAR(32) NOT NULL UNIQUE,
    "instituteId" VARCHAR(255) NOT NULL,
    "examId" VARCHAR(255) NOT NULL,
    "studentId" VARCHAR(255) NOT NULL,
    "rollNo" VARCHAR(32) NOT NULL,
    "classId" VARCHAR(255),
    "sectionId" VARCHAR(255),
    "sessionId" VARCHAR(255) NOT NULL,
    "subjectId" VARCHAR(255) NOT NULL,
    "examType" VARCHAR(255) NOT NULL,
    "sheetId" VARCHAR(255),
    "evaluationId" VARCHAR(255),
    "marksObtained" DECIMAL(7,2),
    "totalMarks" INTEGER NOT NULL,
    "passingMarks" INTEGER NOT NULL,
    "percentage" DECIMAL(5,2),
    "grade" VARCHAR(4),
    "resultStatus" VARCHAR(16) NOT NULL,
    "publishedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "publishedBy" VARCHAR(255) NOT NULL,
    "revisedAt" TIMESTAMP WITH TIME ZONE,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "viaexam_recheck_assignments" (
    "id" SERIAL PRIMARY KEY,
    "requestId" VARCHAR(255) NOT NULL UNIQUE,
    "instituteId" VARCHAR(255) NOT NULL,
    "examId" VARCHAR(255) NOT NULL,
    "teacherId" VARCHAR(255) NOT NULL,
    "assignedBy" VARCHAR(255) NOT NULL,
    "assignedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "previousScore" DECIMAL(7,2),
    "revisedScore" DECIMAL(7,2),
    "teacherNote" VARCHAR(1000),
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
  )`,
];

// Names match the model definitions, so sync() and this migration never create twins.
const INDEXES = [
  // New tables
  `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exam_scanner_assignments_one_active" ON "viaexam_exam_scanner_assignments" ("examId") WHERE "isActive" = true`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exam_scanner_assignments_scanner" ON "viaexam_exam_scanner_assignments" ("scannerId", "isActive")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exam_scanner_assignments_institute" ON "viaexam_exam_scanner_assignments" ("instituteId", "isActive")`,
  `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exam_attendance_exam_student" ON "viaexam_exam_attendance" ("examId", "studentId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exam_attendance_exam_status" ON "viaexam_exam_attendance" ("examId", "status")`,
  `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_student_results_exam_student" ON "viaexam_student_results" ("examId", "studentId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_student_results_student" ON "viaexam_student_results" ("studentId", "isDeleted")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_student_results_institute_exam" ON "viaexam_student_results" ("instituteId", "examId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_recheck_assignments_teacher" ON "viaexam_recheck_assignments" ("teacherId", "completedAt")`,

  // Existing tables: the lookups every panel makes
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_users_institute_role_status_idx" ON "viaexam_users" ("instituteId", "roleId", "status") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_student_profiles_class_section_idx" ON "viaexam_student_profiles" ("instituteId", "classId", "sectionId") WHERE "isActive" = true`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_institute_created_idx" ON "viaexam_exams" ("instituteId", "createdAt" DESC) WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_teacher_idx" ON "viaexam_exams" ("teacherId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_class_subject_type_idx" ON "viaexam_exams" ("instituteId", "classId", "subjectId", "examType") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_exam_roll_idx" ON "viaexam_answer_sheets" ("examId", "rollNo") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_ai_evaluations_student_status_idx" ON "viaexam_ai_evaluations" ("studentId", "status")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_ai_evaluations_exam_idx" ON "viaexam_ai_evaluations" ("examId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_subjects_institute_teacher_idx" ON "viaexam_subjects" ("instituteId", "teacherId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_question_papers_exam_idx" ON "viaexam_question_papers" ("examId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_question_paper_answers_exam_idx" ON "viaexam_question_paper_answers" ("examId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_evaluation_assignments_institute_active_idx" ON "viaexam_evaluation_assignments" ("instituteId", "isActive")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_activity_logs_institute_created_idx" ON "viaexam_activity_logs" ("instituteId", "createdAt" DESC)`,
];

const RECHECK_ONCE_INDEX = `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_recheck_requests_student_exam_once" ON "viaexam_recheck_requests" ("studentId", "examId")`;

module.exports = {
  up: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);

    for (const sql of TABLES) await q(sql);
    for (const sql of INDEXES) {
      // An index on a table this database doesn't have is skipped, not fatal.
      const table = sql.match(/ ON "([^"]+)"/)[1];
      const [[found]] = await q(`SELECT to_regclass('public."${table}"') IS NOT NULL AS ok`);
      if (found.ok) await q(sql);
      // eslint-disable-next-line no-console
      else console.warn(`[migration] table ${table} not found; skipped one index.`);
    }

    // "One recheck per exam" is enforced by the service; the database backs it
    // up only when existing rows allow it (older data may hold duplicates).
    const [dups] = await q(
      `SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM "viaexam_recheck_requests" GROUP BY "studentId", "examId" HAVING COUNT(*) > 1) d`
    );
    if (Number(dups[0]?.n ?? 0) === 0) {
      await q(RECHECK_ONCE_INDEX);
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `[migration] ${dups[0].n} student/exam pairs already have more than one recheck request; ` +
          'skipped the unique index viaexam_recheck_requests_student_exam_once. Clean them up and re-run.'
      );
    }
  },

  down: async (queryInterface) => {
    const q = (sql) => queryInterface.sequelize.query(sql);
    const names = [...INDEXES, RECHECK_ONCE_INDEX]
      .map((sql) => sql.match(/IF NOT EXISTS "([^"]+)"/)[1])
      // Tables dropped below take their own indexes with them.
      .filter((name) => !/^viaexam_(exam_scanner_assignments|exam_attendance|student_results|recheck_assignments)_/.test(name));
    for (const name of names) await q(`DROP INDEX CONCURRENTLY IF EXISTS "${name}"`);
    await q(`DROP TABLE IF EXISTS "viaexam_recheck_assignments"`);
    await q(`DROP TABLE IF EXISTS "viaexam_student_results"`);
    await q(`DROP TABLE IF EXISTS "viaexam_exam_attendance"`);
    await q(`DROP TABLE IF EXISTS "viaexam_exam_scanner_assignments"`);
  },
};
