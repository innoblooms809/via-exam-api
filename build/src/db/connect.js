"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const logger_1 = __importDefault(require("../config/logger"));
const sequelize_1 = require("../config/sequelize");
require("../models/index");
const sessionScopeBackfill_1 = require("./sessionScopeBackfill");
const sectionWorkBackfill_1 = require("./sectionWorkBackfill");
const rollNumberBackfill_1 = require("./rollNumberBackfill");
const examProgress_1 = require("../services/exam/examProgress");
const dataProtectionMaintenance_1 = require("../services/security/dataProtectionMaintenance");
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
    // "Low quality" filter on an exam's sheets.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_exam_quality_idx" ON "viaexam_answer_sheets" ("examId", "qualityFlag") WHERE "isDeleted" = false`,
    // Evaluation maintenance: pending runs (watchdog) and failed ones it may retry.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_ai_evaluations_status_updated_idx" ON "viaexam_ai_evaluations" ("status", "updatedAt") WHERE "status" IN ('Pending', 'Failed')`,
    // Scan-quality sweep: sheets not checked yet.
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS "viaexam_answer_sheets_unchecked_idx" ON "viaexam_answer_sheets" ("createdAt") WHERE "qualityFlag" IS NULL AND "isDeleted" = false`,
];
const ensurePerformanceIndexes = () => __awaiter(void 0, void 0, void 0, function* () {
    for (const sql of PERFORMANCE_INDEXES) {
        yield sequelize_1.sequelize.query(sql).catch((err) => logger_1.default.warn(`Index skipped: ${err === null || err === void 0 ? void 0 : err.message}`));
    }
});
const connectDB = (fn) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield sequelize_1.sequelize.authenticate();
        logger_1.default.info("Connected to PostgreSQL Database");
        yield Promise.resolve().then(() => __importStar(require("../models/index"))); // Ensure all models are imported and registered
        // Ensure newly added columns exist in database
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_users" ADD COLUMN IF NOT EXISTS "profileUrl" VARCHAR(255);`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_evaluation_assignments" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP WITH TIME ZONE;`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_evaluation_assignments" ADD COLUMN IF NOT EXISTS "reviewedBy" VARCHAR(255);`).catch(() => null);
        // Push tokens: one row per (browser, user) instead of one user per browser.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_push_tokens" DROP CONSTRAINT IF EXISTS "viaexam_push_tokens_token_key";`).catch(() => null);
        yield sequelize_1.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS "viaexam_push_tokens_token_user_id" ON "viaexam_push_tokens" ("token", "userId");`).catch(() => null);
        // Recheck claims: the kind of marking concern, the questions it is about, the decision's words.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_recheck_requests" ADD COLUMN IF NOT EXISTS "category" VARCHAR(40), ADD COLUMN IF NOT EXISTS "questions" JSONB, ADD COLUMN IF NOT EXISTS "decisionNote" TEXT;`).catch(() => null);
        // A teacher's recheck decision waits for the admin's approval before it reaches the result.
        yield sequelize_1.sequelize.query(`ALTER TYPE "enum_viaexam_recheck_requests_status" ADD VALUE IF NOT EXISTS 'Awaiting Approval' AFTER 'Under Review';`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_recheck_assignments" ADD COLUMN IF NOT EXISTS "approvedBy" VARCHAR(255), ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "returnNote" TEXT, ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP WITH TIME ZONE;`).catch(() => null);
        // Who approved a change of marks (a recheck decision), beside who made it.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_marks_audit" ADD COLUMN IF NOT EXISTS "approvedBy" VARCHAR(255);`).catch(() => null);
        // Scan quality of each uploaded sheet, and the thresholds the school flags it by.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_answer_sheets" ADD COLUMN IF NOT EXISTS "qualityFlag" VARCHAR(16), ADD COLUMN IF NOT EXISTS "qualityReport" JSONB;`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_institute_settings" ADD COLUMN IF NOT EXISTS "scanQuality" JSONB;`).catch(() => null);
        // Recheck policy: whether students can claim and for how many days (on, 6 by default), and each published result's deadline.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_institute_settings" ADD COLUMN IF NOT EXISTS "recheckPolicy" JSONB;`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_student_results" ADD COLUMN IF NOT EXISTS "recheckClosesAt" TIMESTAMP WITH TIME ZONE;`).catch(() => null);
        // A recheck teacher's re-evaluation (a draft until the admin approves) and what it changes,
        // question by question; the same per-question detail on every change of a student's marks.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_recheck_assignments" ADD COLUMN IF NOT EXISTS "draft" JSONB, ADD COLUMN IF NOT EXISTS "changes" JSONB;`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_marks_audit" ADD COLUMN IF NOT EXISTS "details" JSONB;`).catch(() => null);
        // A cross-checker's re-evaluation (a draft until their verdict) and what the verdict changed.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_cross_check_items" ADD COLUMN IF NOT EXISTS "draft" JSONB, ADD COLUMN IF NOT EXISTS "changes" JSONB;`).catch(() => null);
        // Exam work by section: the section each scanner / evaluator has, and whose sheet each sheet is.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_exam_scanner_assignments" ADD COLUMN IF NOT EXISTS "sectionId" VARCHAR(255);`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_evaluation_assignments" ADD COLUMN IF NOT EXISTS "sectionId" VARCHAR(255);`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_answer_sheets" ADD COLUMN IF NOT EXISTS "sectionId" VARCHAR(255), ADD COLUMN IF NOT EXISTS "studentId" VARCHAR(255);`).catch(() => null);
        // AI evaluation runs through the job queue: when each run was queued / started / ended, how
        // many runs a sheet has had, why the last one failed, and the evaluator's question tree.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_ai_evaluations" ADD COLUMN IF NOT EXISTS "resultTree" JSONB, ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "runCount" INTEGER NOT NULL DEFAULT 0, ADD COLUMN IF NOT EXISTS "failureKind" VARCHAR(16);`).catch(() => null);
        // Why the last run failed, as a code the queue page explains (evaluationFailure.ts), the API
        // process holding the current run (an in-memory queue dies with its process), and where a
        // paused run stopped (pipeline6.service: pause / resume).
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_ai_evaluations" ADD COLUMN IF NOT EXISTS "failure" JSONB, ADD COLUMN IF NOT EXISTS "runOwner" VARCHAR(160), ADD COLUMN IF NOT EXISTS "pause" JSONB;`).catch(() => null);
        // Encrypted columns hold ciphertext, longer than the value (utils/dataProtection): TEXT. A
        // varchar → text change keeps the data and doesn't rewrite the table. Wrong OTP tries.
        yield (0, dataProtectionMaintenance_1.prepareEncryptedColumns)();
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_password_resets" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;`).catch(() => null);
        // Date sheets: a paper is a draft until the admin publishes it; after that a change is a
        // reschedule, kept in changeLog. Existing rows (and other events) are already published.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_academic_calendar" ADD COLUMN IF NOT EXISTS "status" VARCHAR(16) NOT NULL DEFAULT 'published', ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP WITH TIME ZONE, ADD COLUMN IF NOT EXISTS "publishedBy" VARCHAR(255), ADD COLUMN IF NOT EXISTS "changeLog" JSONB;`).catch(() => null);
        yield sequelize_1.sequelize.sync({ force: false });
        logger_1.default.info("Models synced with PostgreSQL");
        // Refuses to start when the database holds values sealed with a key this process lacks.
        yield (0, dataProtectionMaintenance_1.checkStoredKeys)();
        // Once per database: fill the per-session tables (setup, enrolments) from existing data.
        yield (0, sessionScopeBackfill_1.runSessionScopeBackfill)();
        // Every start: a student without any enrolment is placed by their profile.
        yield (0, sessionScopeBackfill_1.ensureEveryStudentEnrolled)();
        // Once per database: roll numbers typed in Arabic or other digits (١٠١) rewritten with 0-9,
        // and file names stored as latin1 read back. Logs and retries next start if it fails.
        yield (0, rollNumberBackfill_1.runRollNumberBackfill)();
        // Exam work by section: per-section keys; once, existing sheets and assignments brought along.
        yield (0, sectionWorkBackfill_1.runSectionWorkBackfill)();
        // "100% evaluated" notifications follow each sheet that gets its marks.
        (0, examProgress_1.watchEvaluationProgress)();
        fn();
        void ensurePerformanceIndexes();
    }
    catch (err) {
        logger_1.default.error("Error connecting to PostgreSQL / syncing models");
        logger_1.default.error((err === null || err === void 0 ? void 0 : err.stack) || (err === null || err === void 0 ? void 0 : err.message) || String(err));
        // Exit process with failure
        process.exit(1);
    }
});
exports.default = connectDB;
