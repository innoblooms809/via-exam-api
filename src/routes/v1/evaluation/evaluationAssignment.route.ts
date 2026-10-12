import { Router } from "express";
import Controller from "../../../controllers/evaluation/evaluationAssignment.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ACADEMIC } from "../../../config/roles";

const router = Router();

// ── Admin: assign approved exams to a teacher of that subject for evaluation ──
router.get("/exams", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.listExams);
router.get("/exams/:examId/teachers", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.listEligibleTeachers);
router.post("/", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.assign);
router.delete("/exams/:examId", authenticate, authorize(["ADMIN", "SUPERADMIN"]), Controller.unassign);

// ── Evaluation pages: students + uploaded sheets (masked for assigned evaluators) ──
router.get("/roster", authenticate, authorize(ACADEMIC), Controller.getRoster);
router.get("/my-exams", authenticate, authorize(ACADEMIC), Controller.myExams);
router.patch("/exams/:examId/review", authenticate, authorize(ACADEMIC), Controller.markReviewed);
router.post("/exams/:examId/review", authenticate, authorize(ACADEMIC), Controller.markReviewed);

export default router;
