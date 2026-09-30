"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const studentdashboard_controller_1 = __importDefault(require("../../controllers/studentdashboard.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
router.get("/overview", auth_1.authenticate, studentdashboard_controller_1.default.getStudentDashboardOverview);
router.get("/exams/upcoming", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getUpcomingExams);
router.get("/exam-progress", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getExamProgress);
router.get("/performance", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getPerformanceOverview);
router.get("/subject-comparison", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getSubjectComparison);
router.get("/results/latest", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getLatestResults);
router.get("/subject-performance", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getSubjectPerformance);
router.get("/activity/recent", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getRecentActivity);
router.get("/recheck-requests", auth_1.authenticate, (0, auth_1.authorize)(["STUDENT"]), studentdashboard_controller_1.default.getRecheckRequests);
exports.default = router;
