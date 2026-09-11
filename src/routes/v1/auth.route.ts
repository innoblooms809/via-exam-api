

import { Router } from "express";
import Controller from "../../controllers/auth.controller";
// No authenticate middleware — user is logged out at this point

const router = Router();

// Forgot Password - Step 1 (send OTP)
router.post(
  "/forgotPassword",
  Controller.forgotPassword
);

// Verify OTP - Step 2 (verify OTP code)
router.post(
  "/verifyOtp",
  Controller.verifyOtp
);

// Reset Password - Step 3 (reset password with verified OTP)
router.post(
  "/resetPassword",
  Controller.resetPassword
);

// Resend Credentials - Generate new password and send email
router.post(
  "/resendCredentials",
  Controller.resendCredentials
);

export default router;