import { Router } from "express";
import Controller from "../../controllers/evaluationAssignment.controller";
import { authenticate, authorize } from "../../middlewares/auth";

const router = Router();

// ── Admin: assign approved exams to a teacher of that subject for evaluation ──
router.get("/exams", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.listExams);
router.get("/exams/:examId/teachers", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.listEligibleTeachers);
router.post("/", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.assign);
router.delete("/exams/:examId", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.unassign);

// ── Evaluation pages: students + uploaded sheets (masked for assigned evaluators) ──
router.get("/roster", authenticate, Controller.getRoster);
router.get("/my-exams", authenticate, Controller.myExams);

export default router;
