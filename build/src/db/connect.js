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
const examProgress_1 = require("../services/exam/examProgress");
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
        // A recheck teacher's re-evaluation (a draft until the admin approves) and what it changes,
        // question by question; the same per-question detail on every change of a student's marks.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_recheck_assignments" ADD COLUMN IF NOT EXISTS "draft" JSONB, ADD COLUMN IF NOT EXISTS "changes" JSONB;`).catch(() => null);
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_marks_audit" ADD COLUMN IF NOT EXISTS "details" JSONB;`).catch(() => null);
        // A cross-checker's re-evaluation (a draft until their verdict) and what the verdict changed.
        yield sequelize_1.sequelize.query(`ALTER TABLE "viaexam_cross_check_items" ADD COLUMN IF NOT EXISTS "draft" JSONB, ADD COLUMN IF NOT EXISTS "changes" JSONB;`).catch(() => null);
        yield sequelize_1.sequelize.sync({ force: false });
        logger_1.default.info("Models synced with PostgreSQL");
        // Once per database: fill the per-session tables (setup, enrolments) from existing data.
        yield (0, sessionScopeBackfill_1.runSessionScopeBackfill)();
        // Every start: a student without any enrolment is placed by their profile.
        yield (0, sessionScopeBackfill_1.ensureEveryStudentEnrolled)();
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
