import { Router } from "express";
import Controller from "../../controllers/session.controller";
import { authenticate, authorize } from "../../middlewares/auth";

const router = Router();

// ─── Admin only ───────────────────────────────────────────────────────────────

// POST /v1/sessions
// Body: { sessionName, startDate, endDate, isActive }
router.post(
  "/createSession",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.createSession
);

// GET  /v1/sessions
// Query: ?isActive=true
router.get(
  "/getAllSessions",
  authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
  Controller.getAllSessions
);

// GET  /v1/sessions/active
// Returns current active session
router.get(
  "/active",
  authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER", "STUDENT"]),
  Controller.getActiveSession
);

// GET  /v1/sessions/:sessionId
router.get(
  "/getOneSession/:sessionId",
  authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
  Controller.getSessionById
);

// PATCH /v1/sessions/:sessionId/activate
// Makes this session active, deactivates all others
router.patch(
  "/:sessionId/activate",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.activateSession
);

// PUT /v1/sessions/:sessionId
router.put(
  "/updateSession/:sessionId",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.updateSession
);

// DELETE /v1/sessions/:sessionId
// Cannot delete active session
router.delete(
  "/deleteSession/:sessionId",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.deleteSession
);

export default router;