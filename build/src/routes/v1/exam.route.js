"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const exam_controller_1 = __importDefault(require("../../controllers/exam.controller"));
const auth_1 = require("../../middlewares/auth");
// import { authenticate, authorize } from "../middlewares/auth";
const router = (0, express_1.Router)();
// Admin and Examiner can create/manage exams
router.post("/createExam", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER"]),
exam_controller_1.default.createExam);
router.get("/getAllExams", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER", "TEACHER"]),
exam_controller_1.default.getAllExams);
router.get("/getOneExam/:examId", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER", "TEACHER"]),
exam_controller_1.default.getExamById);
router.patch("/updateExamStatus/:examId", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER"]),
exam_controller_1.default.updateExamStatus);
router.put("/updateExam/:examId", auth_1.authenticate, exam_controller_1.default.updateExam);
router.delete("/deleteExam/:examId", auth_1.authenticate, 
//   authorize(["ADMIN", "EXAMINER"]),
exam_controller_1.default.deleteExam);
exports.default = router;
