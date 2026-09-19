import { Router } from "express";
import Controller from "../../controllers/recheckRequest.controller";
import { authenticate, authorize } from "../../middlewares/auth";

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
  Controller.getRecheckRequestById
);

// Admin/Teacher routes for reviewing recheck requests
router.patch(
  "/:requestId/status",
  authenticate,
  authorize(["ADMIN", "TEACHER", "EXAMINER"]),
  Controller.updateRecheckRequestStatus
);

export default router;