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
        yield sequelize_1.sequelize.sync({ force: false });
        logger_1.default.info("Models synced with PostgreSQL");
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
