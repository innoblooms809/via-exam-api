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
router.get("/getOneTeacher/:userId", authenticate, authorize(ACADEMIC), Controller.getTeacherById);
router.put("/updateTeacher/:userId", authenticate, authorize(ADMINS), profileUpload, Controller.updateTeacher);
router.patch("/specializations/:userId", authenticate, authorize(ADMINS), Controller.updateSpecializations);
router.delete("/deleteTeacher/:userId", authenticate, authorize(ADMINS), Controller.deleteTeacher);
router.patch("/reactivateTeacher/:userId", authenticate, authorize(ADMINS), Controller.reactivateTeacher);
router.patch("/updateTeacherToExaminer/:userId/assign-examiner", authenticate, authorize(ADMINS), Controller.assignExaminer);
router.patch("/updateTeacherToRemoveExaminer/:userId/remove-examiner", authenticate, authorize(ADMINS), Controller.removeExaminer);

// The signed-in teacher's own work.
router.get("/my-assignments", authenticate, authorize(ACADEMIC), Controller.getMyAssignments);
// Subjects and class-teacher sections per session (Session setup).
router.get("/my-teaching", authenticate, authorize(ACADEMIC), Controller.getMyTeaching);
router.get("/approval-workflow-exams", authenticate, authorize(ACADEMIC), Controller.getTeacherExamsWithApprovalStatus);
router.get("/my-question-papers", authenticate, authorize(ACADEMIC), Controller.getTeacherQuestionPapers);
router.get("/:userId/question-papers", authenticate, authorize(ADMINS), Controller.getTeacherQuestionPapers);

export default router;
