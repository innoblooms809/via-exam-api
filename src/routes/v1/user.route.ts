import { Router } from "express";
import userController from "../../controllers/auth/user.controller" // Adjust the path as needed
// import { RoleType } from "../modals/Role.modal";
import {authenticate,authorize} from "../../middlewares/auth";

const router = Router();

// ─── Public Routes ────────────────────────────────────────────────────────────

/**
 * GET  /api/viaexam/auth/captcha
 * Returns SVG captcha image and stores text in session
 */
router.get("/captcha", userController.getCaptcha);

/**
 * POST /api/viaexam/auth/login
 * Body: { emailId, mobileNo, type, password, captcha }
 * type: 1 = email, 2 = mobile
 */
router.post("/login", userController.loginViaExamUser);

// ─── Protected Routes ─────────────────────────────────────────────────────────

/**
 * POST /api/viaexam/auth/create-user
 * Only super_admin can create ViaExam users
 */
router.post(
  "/create-user",
//   authenticate,
//   authorize(["super_admin","admin"]), // ← only super_admin and admin can create users
  userController.createViaExamUser
);

/**
 * POST /api/viaexam/auth/logout
 */
router.post("/logout", authenticate, userController.logoutViaExamUser);

/**
 * GET  /api/viaexam/auth/me
 */
router.get("/me", authenticate, userController.getViaExamProfile);

export default router;