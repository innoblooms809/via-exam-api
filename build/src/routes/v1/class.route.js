"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middlewares/auth");
const class_controller_1 = __importDefault(require("../../controllers/class.controller"));
const router = (0, express_1.Router)();
// Create a class/section
router.post("/createClass", auth_1.authenticate, 
// authorize(["ADMIN"]),
class_controller_1.default.createClass);
// Get all classes of institute
// ?className=Class 10&academicYear=2024-25
router.get("/getAllClasses", auth_1.authenticate, 
// authorize(["ADMIN", "TEACHER", "EXAMINER"]),
class_controller_1.default.getAllClasses);
// Get one class with students + exams
router.get("/getClassById/:classId", auth_1.authenticate, 
// authorize(["ADMIN", "TEACHER", "EXAMINER"]),
class_controller_1.default.getClassById);
// Update class
router.put("/updateClass/:classId", auth_1.authenticate, 
// authorize(["ADMIN"]),
class_controller_1.default.updateClass);
// Deactivate class
router.delete("/deleteClass/:classId", auth_1.authenticate, 
// authorize(["ADMIN"]),
class_controller_1.default.deleteClass);
exports.default = router;
