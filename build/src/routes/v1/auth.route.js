"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = __importDefault(require("../../controllers/auth.controller"));
const user_controller_1 = __importDefault(require("../../controllers/auth/user.controller"));
const auth_1 = require("../../middlewares/auth");
const multer_1 = require("../../utils/multer");
// No authenticate middleware — user is logged out at this point
const router = (0, express_1.Router)();
// Forgot Password - Step 1 (send OTP)
router.post("/forgotPassword", auth_controller_1.default.forgotPassword);
// Verify OTP - Step 2 (verify OTP code)
router.post("/verifyOtp", auth_controller_1.default.verifyOtp);
// Reset Password - Step 3 (reset password with verified OTP)
router.post("/resetPassword", auth_controller_1.default.resetPassword);
// Resend Credentials - Generate new password and send email
router.post("/resendCredentials", auth_controller_1.default.resendCredentials);
// Change Password - Authenticated user
router.post("/changePassword", auth_1.authenticate, auth_controller_1.default.changePassword);
router.post("/change-password", auth_1.authenticate, auth_controller_1.default.changePassword);
// GET /auth/me, /auth/profile, /auth/profile/user
router.get("/me", auth_1.authenticate, user_controller_1.default.getViaExamProfile);
router.get("/profile", auth_1.authenticate, user_controller_1.default.getViaExamProfile);
router.get("/profile/user", auth_1.authenticate, user_controller_1.default.getViaExamProfile);
// PUT /auth/me, /auth/profile, /auth/profile/user
router.put("/me", auth_1.authenticate, multer_1.profileUpload, user_controller_1.default.updateViaExamProfile);
router.put("/profile", auth_1.authenticate, multer_1.profileUpload, user_controller_1.default.updateViaExamProfile);
router.put("/profile/user", auth_1.authenticate, multer_1.profileUpload, user_controller_1.default.updateViaExamProfile);
exports.default = router;
