"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_status_1 = __importDefault(require("http-status"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const sequelize_1 = require("sequelize");
const getStudentDashboardOverview = (studentId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Get upcoming exams in next 7 days for the student's class
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        const upcomingExams = yield Exam_modal_1.default.count({
            where: {
                instituteId,
                isDeleted: false,
                status: "Live",
                createdAt: {
                    [sequelize_1.Op.lte]: sevenDaysFromNow,
                },
            },
        });
        // Get completed exams for this session
        const completedExams = yield Exam_modal_1.default.count({
            where: {
                instituteId,
                isDeleted: false,
                status: "Completed",
            },
        });
        // Get published results (evaluations with 'Success' status)
        const publishedResults = yield AIEvaluation_modal_1.default.count({
            where: {
                studentId,
                status: "Success",
            },
        });
        // Get pending rechecks (evaluations with 'Failed' status for this student)
        const pendingRechecks = yield AIEvaluation_modal_1.default.count({
            where: {
                studentId,
                status: "Failed",
            },
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student dashboard overview fetched successfully.",
            data: {
                upcomingExams,
                completedExams,
                publishedResults,
                pendingRechecks,
            },
        };
    }
    catch (error) {
        console.error("getStudentDashboardOverview error:", error);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Something went wrong.",
        };
    }
});
exports.default = {
    getStudentDashboardOverview,
};
