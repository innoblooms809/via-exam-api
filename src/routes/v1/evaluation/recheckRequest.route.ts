import { Router } from "express";
import Controller from "../../../controllers/evaluation/recheckRequest.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS, MEMBERS } from "../../../config/roles";

const router = Router();

// Student routes
router.post(
  "/create",
  authenticate,
  authorize(["STUDENT"]),
  Controller.createRecheckRequest
);

router.get(
  "/my-requests",
  authenticate,
  authorize(["STUDENT"]),
  Controller.getStudentRecheckRequests
);

router.get(
  "/:requestId",
  authenticate,
  authorize(MEMBERS),
  Controller.getRecheckRequestById
);

// Admin only: teachers complete rechecks through /exam-workflow/teacher/rechecks
router.patch(
  "/:requestId/status",
  authenticate,
  authorize(ADMINS),
  Controller.updateRecheckRequestStatus
);

export default router;