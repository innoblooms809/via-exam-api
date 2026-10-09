

import { Router } from "express";
import Controller from "../../../controllers/auth/auth.controller";
import userController from "../../../controllers/auth/user.controller";
import { authenticate } from "../../../middlewares/auth";
import { profileUpload } from "../../../utils/multer";
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

// Change Password - Authenticated user
router.post(
  "/changePassword",
  authenticate,
  Controller.changePassword
);
router.post(
  "/change-password",
  authenticate,
  Controller.changePassword
);



// GET /auth/me, /auth/profile, /auth/profile/user
router.get("/me", authenticate, userController.getViaExamProfile);
router.get("/profile", authenticate, userController.getViaExamProfile);
router.get("/profile/user", authenticate, userController.getViaExamProfile);

// PUT /auth/me, /auth/profile, /auth/profile/user
router.put("/me", authenticate, profileUpload, userController.updateViaExamProfile);
router.put("/profile", authenticate, profileUpload, userController.updateViaExamProfile);
router.put("/profile/user", authenticate, profileUpload, userController.updateViaExamProfile);

export default router;