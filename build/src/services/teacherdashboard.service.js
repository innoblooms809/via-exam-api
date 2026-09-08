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
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const sequelize_1 = require("sequelize");
const getTeacherDashboardOverview = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Get assigned classes (where teacher is class teacher)
        const assignedClasses = yield Class_modal_1.default.count({
            where: {
                classTeacherId: teacherId,
                instituteId,
                isDeleted: false,
            },
        });
        // Get assigned subjects
        const assignedSubjects = yield Subject_modal_1.default.count({
            where: {
                teacherId,
                instituteId,
                isDeleted: false,
            },
        });
        // Total classes (either as class teacher or subject teacher)
        const totalClasses = assignedClasses + assignedSubjects;
        // Get upcoming exams in next 7 days for this teacher
        const sevenDaysFromNow = new Date();
        sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
        const upcomingExams = yield Exam_modal_1.default.count({
            where: {
                teacherId,
                instituteId,
                isDeleted: false,
                status: "Live",
                createdAt: {
                    [sequelize_1.Op.lte]: sevenDaysFromNow,
                },
            },
        });
        // Get pending evaluations (answer sheets with 'Pending' status for this teacher's exams)
        const teacherExamIds = yield Exam_modal_1.default.findAll({
            where: {
                teacherId,
                instituteId,
                isDeleted: false,
            },
            attributes: ["examId"],
        });
        const examIds = teacherExamIds.map((exam) => exam.examId);
        const pendingEvaluations = yield AIEvaluation_modal_1.default.count({
            where: {
                examId: {
                    [sequelize_1.Op.in]: examIds,
                },
                status: "Pending",
            },
        });
        // Get recheck requests (evaluations that need review - could be based on status or a recheck flag)
        // For now, let's count evaluations with 'Failed' status that might need recheck
        const recheckRequests = yield AIEvaluation_modal_1.default.count({
            where: {
                examId: {
                    [sequelize_1.Op.in]: examIds,
                },
                status: "Failed",
            },
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher dashboard overview fetched successfully.",
            data: {
                totalClasses,
                upcomingExams,
                pendingEvaluations,
                recheckRequests,
            },
        };
    }
    catch (error) {
        console.error("getTeacherDashboardOverview error:", error);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Something went wrong.",
        };
    }
});
exports.default = {
    getTeacherDashboardOverview,
};
