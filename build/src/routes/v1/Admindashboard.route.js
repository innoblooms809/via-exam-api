"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const Admindashboard_controller_1 = __importDefault(require("../../controllers/Admindashboard.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
router.get("/overview", auth_1.authenticate, Admindashboard_controller_1.default.getOverview);
router.get("/teacher-analytics", auth_1.authenticate, Admindashboard_controller_1.default.getTeacherAnalytics);
router.get("/scanner-analytics", auth_1.authenticate, Admindashboard_controller_1.default.getScannerAnalytics);
router.get("/student-analytics", auth_1.authenticate, Admindashboard_controller_1.default.getStudentAnalytics);
router.get("/super-admin-analytics", auth_1.authenticate, Admindashboard_controller_1.default.getSuperAdminAnalytics);
exports.default = router;
