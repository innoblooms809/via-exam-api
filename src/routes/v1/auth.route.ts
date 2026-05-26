

import { Router } from "express";
import Controller from "../../controllers/auth.controller";
// No authenticate middleware — user is logged out at this point

const router = Router();

// Forgot Password - Step 1 (send OTP)
router.post(
  "/forgotPassword",
  Controller.forgotPassword
);

// Reset Password - Step 2 (verify OTP + new password)
router.post(
  "/resetPassword",
  Controller.resetPassword
);

export default router;