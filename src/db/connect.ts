import logger from "../config/logger";
import { sequelize } from "../config/sequelize";
import '../models/index'
import { ensureEveryStudentEnrolled, runSessionScopeBackfill } from "./sessionScopeBackfill";
import { watchEvaluationProgress } from "../services/exam/examProgress";

// Indexes for hot read paths (notification polling, per-institute counts, dashboard trends).
// sync() never adds indexes to existing tables, so they are created here. CONCURRENTLY
// builds them without blocking writes; it runs after startup so boot isn't delayed.
const PERFORMANCE_INDEXES = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_notifications_user_created_idx" ON "viaexam_notifications" ("userId", "createdAt" DESC) WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_institute_id_idx" ON "viaexam_exams" ("instituteId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_created_at_idx" ON "viaexam_exams" ("createdAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_student_profiles_institute_id_idx" ON "viaexam_student_profiles" ("instituteId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_student_profiles_created_at_idx" ON "viaexam_student_profiles" ("createdAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_teacher_profiles_institute_id_idx" ON "viaexam_teacher_profiles" ("instituteId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_created_at_idx" ON "viaexam_answer_sheets" ("createdAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_ai_evaluations_created_at_idx" ON "viaexam_ai_evaluations" ("createdAt")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_subscription_transactions_paid_at_idx" ON "viaexam_subscription_transactions" ("paidAt") WHERE "status" = 'paid'`,
  // One person's page (services/dashboard/person.service): every list is filtered by the person.
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_teacher_session_idx" ON "viaexam_exams" ("teacherId", "sessionId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_class_section_idx" ON "viaexam_exams" ("classId", "sectionId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exams_session_class_idx" ON "viaexam_exams" ("sessionId", "classId") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_activity_logs_user_event_created_idx" ON "viaexam_activity_logs" ("userId", "eventType", "createdAt" DESC)`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_uploader_created_idx" ON "viaexam_answer_sheets" ("uploadedBy", "createdAt" DESC) WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_class_roll_idx" ON "viaexam_answer_sheets" ("classId", "rollNo") WHERE "isDeleted" = false`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_recheck_assignments_teacher_idx" ON "viaexam_recheck_assignments" ("teacherId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_recheck_requests_student_idx" ON "viaexam_recheck_requests" ("studentId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_exam_attendance_student_idx" ON "viaexam_exam_attendance" ("studentId")`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_ai_evaluations_student_idx" ON "viaexam_ai_evaluations" ("studentId")`,
];

const ensurePerformanceIndexes = async () => {
  for (const sql of PERFORMANCE_INDEXES) {
    await sequelize.query(sql).catch((err) => logger.warn(`Index skipped: ${err?.message}`));
  }
};

const connectDB = async (fn: any) => {
  try {
    await sequelize.authenticate();
    logger.info("Connected to PostgreSQL Database");
    await import("../models/index"); // Ensure all models are imported and registered

    // Ensure newly added columns exist in database
    await sequelize.query(
      `ALTER TABLE "viaexam_users" ADD COLUMN IF NOT EXISTS "profileUrl" VARCHAR(255);`
    ).catch(() => null);
    await sequelize.query(
      `ALTER TABLE "viaexam_evaluation_assignments" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP WITH TIME ZONE;`
    ).catch(() => null);
    await sequelize.query(
      `ALTER TABLE "viaexam_evaluation_assignments" ADD COLUMN IF NOT EXISTS "reviewedBy" VARCHAR(255);`
    ).catch(() => null);
    // Push tokens: one row per (browser, user) instead of one user per browser.
    await sequelize.query(
      `ALTER TABLE "viaexam_push_tokens" DROP CONSTRAINT IF EXISTS "viaexam_push_tokens_token_key";`
    ).catch(() => null);
    await sequelize.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "viaexam_push_tokens_token_user_id" ON "viaexam_push_tokens" ("token", "userId");`
    ).catch(() => null);

    await sequelize.sync({ force: false });
    logger.info("Models synced with PostgreSQL");

    // Once per database: fill the per-session tables (setup, enrolments) from existing data.
    await runSessionScopeBackfill();
    // Every start: a student without any enrolment is placed by their profile.
    await ensureEveryStudentEnrolled();
    // "100% evaluated" notifications follow each sheet that gets its marks.
    watchEvaluationProgress();

    fn();
    void ensurePerformanceIndexes();
  } catch (err: any) {
    logger.error("Error connecting to PostgreSQL / syncing models");
    logger.error(err?.stack || err?.message || String(err));
    // Exit process with failure
    process.exit(1);
  }
};

export default connectDB;
