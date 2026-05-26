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
// Reset Password - Step 2 (verify OTP + new password)
router.post("/resetPassword", auth_controller_1.default.resetPassword);
