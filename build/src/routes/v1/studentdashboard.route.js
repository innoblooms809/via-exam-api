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
exports.default = router;
