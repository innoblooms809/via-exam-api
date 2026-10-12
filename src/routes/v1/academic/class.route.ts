import { Router } from "express";
import { authenticate, authorize } from "../../../middlewares/auth";
import ClassController from "../../../controllers/academic/class.controller";
import { ADMINS, MEMBERS } from "../../../config/roles";

const router = Router();

// Create a class/section
router.post("/createClass", authenticate, authorize(ADMINS), ClassController.createClass);

// Get all classes of institute
// ?className=Class 10&academicYear=2024-25
router.get("/getAllClasses", authenticate, authorize(MEMBERS), ClassController.getAllClasses);

// Get one class with students + exams
router.get("/getClassById/:classId", authenticate, authorize(MEMBERS), ClassController.getClassById);

// Update class
router.put("/updateClass/:classId", authenticate, authorize(ADMINS), ClassController.updateClass);

// Deactivate class
router.delete("/deleteClass/:classId", authenticate, authorize(ADMINS), ClassController.deleteClass);

export default router;
