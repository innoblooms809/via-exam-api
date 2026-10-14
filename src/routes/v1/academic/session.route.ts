import { Router } from "express";
import Controller from "../../../controllers/academic/session.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS, MEMBERS } from "../../../config/roles";

const router = Router();

// Body: { sessionName, startDate, endDate, isActive }
router.post("/createSession", authenticate, authorize(ADMINS), Controller.createSession);

// Query: ?isActive=true
router.get("/getAllSessions", authenticate, authorize(MEMBERS), Controller.getAllSessions);

// Returns current active session
router.get("/active", authenticate, authorize(MEMBERS), Controller.getActiveSession);

router.get("/getOneSession/:sessionId", authenticate, authorize(MEMBERS), Controller.getSessionById);

// Makes this session active, deactivates all others
router.patch("/:sessionId/activate", authenticate, authorize(ADMINS), Controller.activateSession);

router.put("/updateSession/:sessionId", authenticate, authorize(ADMINS), Controller.updateSession);

// Cannot delete active session
router.delete("/deleteSession/:sessionId", authenticate, authorize(ADMINS), Controller.deleteSession);

export default router;
