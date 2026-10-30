import { Router } from "express";
import Controller from "../../../controllers/exam/crossCheck.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS, TEACHERS } from "../../../config/roles";

// /cross-checks — a second teacher checks chosen papers' marks before results are published.
const router = Router();
router.use(authenticate);

// Admin: exams to cross-check, one exam's papers and round, start / change checker / start over.
router.get("/", authorize(ADMINS), Controller.listExams);
router.get("/exams/:examId", authorize(ADMINS), Controller.examDetail);
router.post("/exams/:examId/start", authorize(ADMINS), Controller.startRound);
router.patch("/exams/:examId/checker", authorize(ADMINS), Controller.changeChecker);
router.delete("/exams/:examId", authorize(ADMINS), Controller.resetRound);

// Cross-checker: my papers, and my verdict on one.
router.get("/mine", authorize(TEACHERS), Controller.myRounds);
router.post("/items/:itemId/check", authorize(TEACHERS), Controller.checkItem);

export default router;
