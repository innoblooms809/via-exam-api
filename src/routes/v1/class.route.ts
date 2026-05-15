import { Router } from "express";
import { authenticate, authorize } from "../../middlewares/auth";
import ClassController from "../../controllers/class.controller";

const router = Router();

// Create a class/section
router.post(
  "/createClass",
  authenticate,
  // authorize(["ADMIN"]),
  ClassController.createClass
);

// Get all classes of institute
// ?className=Class 10&academicYear=2024-25
router.get(
  "/getAllClasses",
  authenticate,
  // authorize(["ADMIN", "TEACHER", "EXAMINER"]),
  ClassController.getAllClasses
);

// Get one class with students + exams
router.get(
  "/getClassById/:classId",
  authenticate,
  // authorize(["ADMIN", "TEACHER", "EXAMINER"]),
  ClassController.getClassById
);

// Update class
router.put(
  "/updateClass/:classId",
  authenticate,
  // authorize(["ADMIN"]),
  ClassController.updateClass
);

// Deactivate class
router.delete(
  "/deleteClass/:classId",
  authenticate,
  // authorize(["ADMIN"]),
  ClassController.deleteClass
);

export default router;