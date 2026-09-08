"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboard_controller_1 = __importDefault(require("../../controllers/dashboard.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
router.get("/institutes", auth_1.authenticate, dashboard_controller_1.default.getInstituteStats);
router.get("/students", auth_1.authenticate, dashboard_controller_1.default.getStudentStats);
router.get("/exams", auth_1.authenticate, dashboard_controller_1.default.getExamStats);
router.get("/evaluated-sheets", auth_1.authenticate, dashboard_controller_1.default.getEvaluatedAnswersheetStats);
exports.default = router;
