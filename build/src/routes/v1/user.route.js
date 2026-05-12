"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = __importDefault(require("../../controllers/auth/user.controller")); // Adjust the path as needed
// import { RoleType } from "../modals/Role.modal";
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
// ─── Public Routes ────────────────────────────────────────────────────────────
/**
 * GET  /api/viaexam/auth/captcha
 * Returns SVG captcha image and stores text in session
 */
router.get("/captcha", user_controller_1.default.getCaptcha);
/**
 * POST /api/viaexam/auth/login
 * Body: { emailId, mobileNo, type, password, captcha }
 * type: 1 = email, 2 = mobile
 */
router.post("/login", user_controller_1.default.loginViaExamUser);
/**
 * POST /api/viaexam/user/refresh-token
 * Reads refreshToken from httpOnly cookie and refreshes accessToken.
 */
router.post("/refresh-token", user_controller_1.default.refreshAccessToken);
// ─── Protected Routes ─────────────────────────────────────────────────────────
/**
 * POST /api/viaexam/auth/create-user
 * Only super_admin can create ViaExam users
 */
router.post("/create-user", 
//   authenticate,
//   authorize(["super_admin","admin"]), // ← only super_admin and admin can create users
user_controller_1.default.createViaExamUser);
/**
 * POST /api/viaexam/auth/logout
 */
router.post("/logout", auth_1.authenticate, user_controller_1.default.logoutViaExamUser);
/**
 * GET  /api/viaexam/auth/me
 */
router.get("/me", auth_1.authenticate, user_controller_1.default.getViaExamProfile);
exports.default = router;
