"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = __importDefault(require("../../controllers/auth/user.controller")); // Adjust the path as needed
// import { RoleType } from "../modals/Role.modal";
const auth_1 = require("../../middlewares/auth");
const validate_1 = __importDefault(require("../../middlewares/validate"));
const user_validation_1 = __importDefault(require("../../validations/user.validation"));
const router = (0, express_1.Router)();
// ─── Public Routes ────────────────────────────────────────────────────────────
/**
 * GET  /api/viaexam/auth/captcha
 * Returns SVG captcha image and stores text in session
 */
router.get("/captcha", user_controller_1.default.getCaptcha);
/**
 * POST /api/viaexam/auth/login
 * Body: { slug, emailId, password }
 */
router.post("/login", (0, validate_1.default)(user_validation_1.default.loginValidation), user_controller_1.default.loginViaExamUser);
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
router.post("/create-user", auth_1.authenticate, 
//   authorize(["super_admin","admin"]), // ← only super_admin and admin can create users
user_controller_1.default.createViaExamUser);
/**
 * POST /api/viaexam/auth/logout
 */
router.post("/logout", auth_1.authenticate, user_controller_1.default.logoutViaExamUser);
const multer_1 = require("../../utils/multer");
/**
 * GET  /auth/me, /auth/profile, /auth/profile/user
 */
router.get("/me", auth_1.authenticate, user_controller_1.default.getViaExamProfile);
router.get("/profile", auth_1.authenticate, user_controller_1.default.getViaExamProfile);
router.get("/profile/user", auth_1.authenticate, user_controller_1.default.getViaExamProfile);
/**
 * PUT  /auth/me, /auth/profile, /auth/profile/user
 */
router.put("/me", auth_1.authenticate, multer_1.profileUpload, user_controller_1.default.updateViaExamProfile);
router.put("/profile", auth_1.authenticate, multer_1.profileUpload, user_controller_1.default.updateViaExamProfile);
router.put("/profile/user", auth_1.authenticate, multer_1.profileUpload, user_controller_1.default.updateViaExamProfile);
exports.default = router;
