import { Router } from "express";
import userController from "../../controllers/auth/user.controller" // Adjust the path as needed
// import { RoleType } from "../modals/Role.modal";
import {authenticate,authorize} from "../../middlewares/auth";
import validate from "../../middlewares/validate";
import userValidation from "../../validations/user.validation";

const router = Router();

// ─── Public Routes ────────────────────────────────────────────────────────────

/**
 * GET  /api/viaexam/auth/captcha
 * Returns SVG captcha image and stores text in session
 */
router.get("/captcha", userController.getCaptcha);

/**
 * POST /api/viaexam/auth/login
 * Body: { slug, emailId, password }
 */
router.post("/login",
   validate(userValidation.loginValidation),
   userController.loginViaExamUser);

/**
 * POST /api/viaexam/user/refresh-token
 * Reads refreshToken from httpOnly cookie and refreshes accessToken.
 */
router.post("/refresh-token", userController.refreshAccessToken);

// ─── Protected Routes ─────────────────────────────────────────────────────────

/**
 * POST /api/viaexam/auth/create-user
 * Only super_admin can create ViaExam users
 */
router.post(
  "/create-user",
  authenticate,
//   authorize(["super_admin","admin"]), // ← only super_admin and admin can create users
  userController.createViaExamUser
);

/**
 * POST /api/viaexam/auth/logout
 */
router.post("/logout", authenticate, userController.logoutViaExamUser);

import { profileUpload } from "../../utils/multer";

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
