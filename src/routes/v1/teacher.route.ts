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
//   authorize(["ADMIN"]),
  handleUploadFile.single("profilePhoto"),
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
  handleUploadFile.single("profilePicture"),
  Controller.updateTeacher
);

// DELETE /v1/teachers/:userId
router.delete(
  "/deleteTeacher/:userId",
  authenticate,
//   authorize(["ADMIN"]),
  Controller.deleteTeacher
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

export default router;