"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const teacher_controller_1 = __importDefault(require("../../controllers/teacher.controller"));
const auth_1 = require("../../middlewares/auth");
// import { handleUploadFile } from "../../utils/multer";
const uploadSingleFile_1 = require("../../utils/uploadSingleFile");
const router = (0, express_1.Router)();
// All routes are admin only
// POST   /v1/teachers
router.post("/createTeacher", auth_1.authenticate, 
// authorize(["ADMIN"]),
uploadSingleFile_1.handleUploadFile.fields([{ name: "profilePhoto", maxCount: 1 }]), teacher_controller_1.default.createTeacher);
// GET    /v1/teachers
// ?search=john&isExaminer=true
router.get("/getAllTeachers", auth_1.authenticate, 
//   authorize(["ADMIN"]),
teacher_controller_1.default.getAllTeachers);
router.get("/getDeactivatedTeachers", auth_1.authenticate, teacher_controller_1.default.getDeactivatedTeachers);
// GET    /v1/teachers/:userId
router.get("/getOneTeacher/:userId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
teacher_controller_1.default.getTeacherById);
// PUT    /v1/teachers/:userId
router.put("/updateTeacher/:userId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
uploadSingleFile_1.handleUploadFile.fields([{ name: "profilePhoto", maxCount: 1 }]), teacher_controller_1.default.updateTeacher);
// DELETE /v1/teachers/:userId
router.delete("/deleteTeacher/:userId", auth_1.authenticate, 
//   authorize(["ADMIN"]),
teacher_controller_1.default.deleteTeacher);
// PATCH  /v1/teachers/reactivateTeacher/:userId
router.patch("/reactivateTeacher/:userId", auth_1.authenticate, teacher_controller_1.default.reactivateTeacher);
// PATCH  /v1/teachers/:userId/assign-examiner
router.patch("/updateTeacherToExaminer/:userId/assign-examiner", auth_1.authenticate, 
//   authorize(["ADMIN"]),
teacher_controller_1.default.assignExaminer);
// PATCH  /v1/teachers/:userId/remove-examiner
router.patch("/updateTeacherToRemoveExaminer/:userId/remove-examiner", auth_1.authenticate, 
//   authorize(["ADMIN"]),
teacher_controller_1.default.removeExaminer);
// GET /v1/teachers/my-assignments
router.get("/my-assignments", auth_1.authenticate, teacher_controller_1.default.getMyAssignments);
// GET /v1/teachers/my-question-papers
router.get("/my-question-papers", auth_1.authenticate, teacher_controller_1.default.getTeacherQuestionPapers);
// GET /v1/teachers/:userId/question-papers
router.get("/:userId/question-papers", auth_1.authenticate, teacher_controller_1.default.getTeacherQuestionPapers);
exports.default = router;
