import { Router } from "express";
import Controller from "../../../controllers/exam/exam.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ACADEMIC, ADMINS, STAFF } from "../../../config/roles";

const router = Router();

// The school admin creates and manages exams; staff read them.
router.post("/createExam", authenticate, authorize(ADMINS), Controller.createExam);
router.get("/getAllExams", authenticate, authorize(STAFF), Controller.getAllExams);
router.get("/assigned", authenticate, authorize(ACADEMIC), Controller.getAssignedExams);
router.get("/assigned-summary", authenticate, authorize(ACADEMIC), Controller.getAssignedExamsSummary);
router.get("/getOneExam/:examId", authenticate, authorize(STAFF), Controller.getExamById);
router.patch("/updateExamStatus/:examId", authenticate, authorize(ADMINS), Controller.updateExamStatus);
router.put("/updateExam/:examId", authenticate, authorize(ADMINS), Controller.updateExam);
router.delete("/deleteExam/:examId", authenticate, authorize(ADMINS), Controller.deleteExam);
router.get("/progress/:examId", authenticate, authorize(STAFF), Controller.getExamProgress);

export default router;
