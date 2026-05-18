import { Router } from "express";
import Controller from "../../controllers/exam/exam.controller";
import { authenticate } from "../../middlewares/auth"
// import { getExamBySelection }      from "../../controllers/exam/getExamBySelection";
// import { authenticate, authorize } from "../middlewares/auth";


const router = Router();

// Admin and Examiner can create/manage exams
router.post(
  "/createExam",
  authenticate,
//   authorize(["ADMIN", "EXAMINER"]),
  Controller.createExam,
);
router.get(
  "/getAllExams",
  authenticate,
//   authorize(["ADMIN", "EXAMINER", "TEACHER"]),
  Controller.getAllExams,
);
router.get(
  "/getOneExam/:examId",
  authenticate,
//   authorize(["ADMIN", "EXAMINER", "TEACHER"]),
  Controller.getExamById,
);
router.patch(
  "/updateExamStatus/:examId",
  authenticate,
//   authorize(["ADMIN", "EXAMINER"]),
  Controller.updateExamStatus,
);

router.put(
  "/updateExam/:examId",
    authenticate,
  Controller.updateExam
);
router.delete(
  "/deleteExam/:examId",
  authenticate,
//   authorize(["ADMIN", "EXAMINER"]),
  Controller.deleteExam,
)






export default router;
