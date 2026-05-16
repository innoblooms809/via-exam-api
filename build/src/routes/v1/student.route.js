"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const student_controller_1 = __importDefault(require("../../controllers/student.controller"));
// import { authenticate, authorize } from "../middlewares/auth";
// import  handleUploadFile  from "../../utils/multer";
const router = (0, express_1.Router)();
// POST   /v1/students
router.post("/", 
//   authenticate,
//   authorize(["ADMIN"]),
//   userUpload,
student_controller_1.default.createStudent);
// POST   /v1/students/bulk
router.post("/bulk", 
//   authenticate,
//   authorize(["ADMIN"]),
student_controller_1.default.bulkCreateStudents);
// GET    /v1/students
// ?search=john&className=Class 10&division=A&academicYear=2024-25
router.get("/", 
//   authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
student_controller_1.default.getAllStudents);
// GET    /v1/students/:userId
router.get("/:userId", 
//   authenticate,
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
student_controller_1.default.getStudentById);
// PUT    /v1/students/:userId
router.put("/:userId", 
//   authenticate,
//   authorize(["ADMIN"]),
//   userUpload,
student_controller_1.default.updateStudent);
// DELETE /v1/students/:userId
router.delete("/:userId", 
//   authenticate,
//   authorize(["ADMIN"]),
student_controller_1.default.deleteStudent);
exports.default = router;
