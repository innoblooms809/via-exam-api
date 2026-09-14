"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const teacherdashboard_controller_1 = __importDefault(require("../../controllers/teacherdashboard.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
router.get("/overview", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getTeacherDashboardOverview);
router.get("/upcoming-exams", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getUpcomingExams);
router.get("/exam-activity", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getExamActivity);
router.get("/activity-overview", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getActivityOverview);
router.get("/upcoming-work", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getUpcomingWork);
router.get("/evaluation-status", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getEvaluationStatus);
router.get("/subject-workload", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getSubjectWorkload);
router.get("/activity/recent", auth_1.authenticate, (0, auth_1.authorize)(["TEACHER"]), teacherdashboard_controller_1.default.getRecentActivity);
exports.default = router;
