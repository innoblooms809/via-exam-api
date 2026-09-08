"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = __importDefault(require("../../controllers/auth.controller"));
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
exports.default = router;
