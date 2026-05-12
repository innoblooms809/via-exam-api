import { Router } from "express";
import Controller from "../../controllers/student.controller";
// import { authenticate, authorize } from "../middlewares/auth";
// import  handleUploadFile  from "../../utils/multer";

const router = Router();

// POST   /v1/students
router.post(
  "/",
//   authenticate,
//   authorize(["ADMIN"]),
//   userUpload,
  Controller.createStudent
);

// POST   /v1/students/bulk
router.post(
  "/bulk",
//   authenticate,
//   authorize(["ADMIN"]),
  Controller.bulkCreateStudents
);

// GET    /v1/students
// ?search=john&className=Class 10&division=A&academicYear=2024-25
router.get(
  "/",
//   authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
  Controller.getAllStudents
);

// GET    /v1/students/:userId
router.get(
  "/:userId",
//   authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
  Controller.getStudentById
);

// PUT    /v1/students/:userId
router.put(
  "/:userId",
//   authenticate,
//   authorize(["ADMIN"]),
//   userUpload,
  Controller.updateStudent
);

// DELETE /v1/students/:userId
router.delete(
  "/:userId",
//   authenticate,
//   authorize(["ADMIN"]),
  Controller.deleteStudent
);

export default router;