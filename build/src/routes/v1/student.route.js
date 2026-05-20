"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const student_controller_1 = __importDefault(require("../../controllers/student.controller"));
const auth_1 = require("../../middlewares/auth");
// import  handleUploadFile  from "../../utils/multer";
const router = (0, express_1.Router)();
// POST   /v1/students
router.post("/createStudent", auth_1.authenticate, 
//   authorize(["ADMIN"]),
//   userUpload,
student_controller_1.default.createStudent);
// POST   /v1/students/bulk
router.post("/createBulkStudents", auth_1.authenticate, 
//   authorize(["ADMIN"]),
student_controller_1.default.bulkCreateStudents);
// GET    /v1/students
// ?search=john&className=Class 10&division=A&academicYear=2024-25
router.get("/getAllStudents", auth_1.authenticate, 
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
student_controller_1.default.getAllStudents);
// GET    /v1/students/:userId
router.get("/getStudentById/:userId", auth_1.authenticate, 
//   authorize(["ADMIN", "TEACHER", "EXAMINER"]),
student_controller_1.default.getStudentById);
// PUT    /v1/students/:userId
router.put("/updateStudent/:userId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
//   userUpload,
student_controller_1.default.updateStudent);
// DELETE /v1/students/:userId
router.delete("/deleteStudent/:userId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
student_controller_1.default.deleteStudent);
exports.default = router;
