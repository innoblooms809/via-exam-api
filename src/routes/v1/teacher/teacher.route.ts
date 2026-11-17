import { Router } from "express";
import Controller from "../../../controllers/teacher/teacher.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { profileUpload } from "../../../utils/multer";
import { ACADEMIC, ADMINS } from "../../../config/roles";

const router = Router();

// Teacher management is admin only; teachers read their own work below.
router.post("/createTeacher", authenticate, authorize(ADMINS), profileUpload, Controller.createTeacher);
router.get("/getAllTeachers", authenticate, authorize(ACADEMIC), Controller.getAllTeachers);
router.get("/getDeactivatedTeachers", authenticate, authorize(ADMINS), Controller.getDeactivatedTeachers);
router.put("/updateTeacher/:userId", authenticate, authorize(ADMINS), profileUpload, Controller.updateTeacher);
router.patch("/specializations/:userId", authenticate, authorize(ADMINS), Controller.updateSpecializations);
router.delete("/deleteTeacher/:userId", authenticate, authorize(ADMINS), Controller.deleteTeacher);
router.patch("/reactivateTeacher/:userId", authenticate, authorize(ADMINS), Controller.reactivateTeacher);
// Subjects and class-teacher sections per session (Session setup).
router.get("/my-teaching", authenticate, authorize(ACADEMIC), Controller.getMyTeaching);
// The students of one of those classes or sections.
router.get("/my-teaching/students", authenticate, authorize(ACADEMIC), Controller.getMyStudents);
router.get("/my-question-papers", authenticate, authorize(ACADEMIC), Controller.getTeacherQuestionPapers);
router.get("/:userId/question-papers", authenticate, authorize(ADMINS), Controller.getTeacherQuestionPapers);

export default router;
