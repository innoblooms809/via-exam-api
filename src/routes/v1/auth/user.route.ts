import { Router } from "express";
import userController from "../../../controllers/auth/user.controller" // Adjust the path as needed
// import { RoleType } from "../modals/Role.modal";
import {authenticate,authorize} from "../../../middlewares/auth";
import validate from "../../../middlewares/validate";
import userValidation from "../../../validations/user.validation";
import { loginLimiter } from "../../../middlewares/rateLimiter";

const router = Router();

// ─── Public Routes ────────────────────────────────────────────────────────────

/**
 * GET  /api/viaexam/auth/captcha
 * Returns SVG captcha image and stores text in session
 */
router.get("/captcha", userController.getCaptcha);

/**
 * POST /v1/user/login   Body: { slug, emailId, password }
 * Sets the session's httpOnly cookies; the body carries the profile only.
 */
router.post("/login",
   loginLimiter,
   validate(userValidation.loginValidation),
   userController.loginViaExamUser);

/**
 * POST /v1/user/refresh-token   No body: reads the refresh cookie, which the browser sends only
 * to this path, and sets new cookies.
 */
router.post("/refresh-token", userController.refreshAccessToken);

// ─── Protected Routes ─────────────────────────────────────────────────────────

/**
 * POST /v1/user/create-user — super admins only (it can create an account with any role).
 * Institute users are created through the teacher / student / scanner endpoints instead.
 */
router.post(
  "/create-user",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  userController.createViaExamUser
);

/**
 * POST /v1/user/logout       ends this session
 * POST /v1/user/logout-all   ends every session of this user
 */
router.post("/logout", authenticate, userController.logoutViaExamUser);
router.post("/logout-all", authenticate, userController.logoutEverywhere);

import { profileUpload } from "../../../utils/multer";

/**
 * GET  /auth/me, /auth/profile, /auth/profile/user
 */
router.get("/me", authenticate, userController.getViaExamProfile);
router.get("/profile", authenticate, userController.getViaExamProfile);
router.get("/profile/user", authenticate, userController.getViaExamProfile);

/**
 * PUT  /auth/me, /auth/profile, /auth/profile/user
 */
router.put("/me", authenticate, profileUpload, userController.updateViaExamProfile);
router.put("/profile", authenticate, profileUpload, userController.updateViaExamProfile);
router.put("/profile/user", authenticate, profileUpload, userController.updateViaExamProfile);

export default router;
