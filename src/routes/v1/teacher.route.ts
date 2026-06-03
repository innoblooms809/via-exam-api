import { Router } from "express";
import Controller from "../../controllers/teacher.controller";
import { authenticate, authorize } from "../../middlewares/auth";
// import { handleUploadFile } from "../../utils/multer";

import { handleUploadFile } from "../../utils/uploadSingleFile";
const router = Router();

// All routes are admin only
// POST   /v1/teachers
router.post(
  "/createTeacher",
  authenticate,
  // authorize(["ADMIN"]),
  handleUploadFile.fields([{ name: "profilePhoto", maxCount: 1 }]),
  Controller.createTeacher
);

// GET    /v1/teachers
// ?search=john&isExaminer=true
router.get(
  "/getAllTeachers",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.getAllTeachers
);

router.get(
  "/getDeactivatedTeachers",
  authenticate,
  Controller.getDeactivatedTeachers
);

// GET    /v1/teachers/:userId
router.get(
  "/getOneTeacher/:userId",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.getTeacherById
);

// PUT    /v1/teachers/:userId
router.put(
  "/updateTeacher/:userId",
  authenticate,
//   authorize(["ADMIN"]),
  handleUploadFile.fields([{ name: "profilePhoto", maxCount: 1 }]),
  Controller.updateTeacher
);

// DELETE /v1/teachers/:userId
router.delete(
  "/deleteTeacher/:userId",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.deleteTeacher
);

// PATCH  /v1/teachers/reactivateTeacher/:userId
router.patch(
  "/reactivateTeacher/:userId",
  authenticate,
  Controller.reactivateTeacher
);

// PATCH  /v1/teachers/:userId/assign-examiner
router.patch(
  "/updateTeacherToExaminer/:userId/assign-examiner",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.assignExaminer
);

// PATCH  /v1/teachers/:userId/remove-examiner
router.patch(
  "/updateTeacherToRemoveExaminer/:userId/remove-examiner",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.removeExaminer
);

// GET /v1/teachers/my-assignments
router.get(
  "/my-assignments",
  authenticate,
  Controller.getMyAssignments
);

export default router;