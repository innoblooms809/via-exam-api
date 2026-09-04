import express from "express";
import { authenticate, authorize, verifyTenant } from "../../middlewares/auth";
import * as monitoringController from "../../controllers/monitoring.controller";

const router = express.Router();

// ── Heartbeat Endpoint (Open to all authenticated active sessions) ───────────
router.post("/heartbeat", authenticate, monitoringController.recordHeartbeat);

// ── Cleanup Stale Sessions (Admin only - runs periodically) ───────────────────
router.post("/cleanup", authenticate, authorize(["SUPER_ADMIN", "ADMIN"]), monitoringController.cleanupStaleSessions);

// ── Platform-Wide Monitoring (Super Admin ONLY — Global across all institutes) ──
router.get(
  "/platform/overview",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  monitoringController.getPlatformOverview
);

router.get(
  "/platform/users",
  authenticate,
  authorize(["SUPER_ADMIN"]),
  monitoringController.getPlatformUsers
);

// ── Institute-Scoped Monitoring (Admin & SuperAdmin — scoped to requester's institute) ──
router.get(
  "/overview",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  verifyTenant,
  monitoringController.getMonitoringOverview
);

router.get(
  "/users",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  verifyTenant,
  monitoringController.getMonitoredUsers
);

router.get(
  "/users/:userId",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  verifyTenant,
  monitoringController.getUserDetailsAndTimeline
);

router.get(
  "/activity",
  authenticate,
  authorize(["SUPER_ADMIN", "ADMIN"]),
  verifyTenant,
  monitoringController.getActivityLogs
);

export default router;
