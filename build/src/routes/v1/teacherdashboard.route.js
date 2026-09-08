"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const teacherdashboard_controller_1 = __importDefault(require("../../controllers/teacherdashboard.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
router.get("/overview", auth_1.authenticate, teacherdashboard_controller_1.default.getTeacherDashboardOverview);
exports.default = router;
