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
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const RecheckRequest_modal_1 = __importDefault(require("../modals/RecheckRequest.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const ActivityLog_modal_1 = __importDefault(require("../modals/ActivityLog.modal"));
const sequelize_1 = require("sequelize");
const adminDashboard_helper_1 = require("../utils/adminDashboard.helper");
const getStudentDashboardOverview = (studentId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Get student's profile to determine their class and section
        const studentProfile = yield Student_modal_1.default.findOne({
            where: { userId: studentId, instituteId },
            attributes: ["classId", "sectionId", "instituteId"],
        });
        if (!studentProfile) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Student profile not found.",
            };
        }
        const { classId } = studentProfile;
        // Get upcoming exams for the student's class
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const upcomingExams = yield Exam_modal_1.default.count({
            where: {
                instituteId,
                classId,
                isDeleted: false,
                status: "Live",
                examDate: { [sequelize_1.Op.gte]: today },
            },
        });
        // Get completed exams for the student - exams where student has successful evaluation
        const studentSuccessfulEvals = yield AIEvaluation_modal_1.default.findAll({
            where: {
                studentId,
                status: "Success",
            },
            attributes: ["examId"],
            group: ["examId"],
        });
        const completedExams = studentSuccessfulEvals.length;
        // Get published results (evaluations with 'Success' status for this student)
        const publishedResults = yield AIEvaluation_modal_1.default.count({
            where: {
                studentId,
                status: "Success",
            },
        });
        // Get pending rechecks - using RecheckRequest model
        const pendingRechecks = yield RecheckRequest_modal_1.default.count({
            where: {
                studentId,
                instituteId,
                status: { [sequelize_1.Op.in]: ["Pending", "Under Review"] },
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
const getUpcomingExams = (studentId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentProfile = yield Student_modal_1.default.findOne({
            where: { userId: studentId, instituteId },
            attributes: ["classId"],
        });
        if (!studentProfile) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Student profile not found." };
        }
        const { classId } = studentProfile;
        const page = Math.max(1, parseInt(query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
        const offset = (page - 1) * limit;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const { count, rows } = yield Exam_modal_1.default.findAndCountAll({
            where: {
                instituteId,
                classId,
                isDeleted: false,
                status: "Live",
                examDate: { [sequelize_1.Op.gte]: today },
            },
            include: [
                { model: Subject_modal_1.default, as: "subject", attributes: ["subjectId", "subjectName"], required: true },
                { model: Class_modal_1.default, as: "class", attributes: ["classId", "className"], required: true },
            ],
            order: [
                ["examDate", "ASC"],
                ["examTime", "ASC"],
            ],
            limit,
            offset,
        });
        const exams = rows.map((exam) => {
            var _a, _b, _c;
            return ({
                exam: `${exam.examType} - ${((_a = exam.subject) === null || _a === void 0 ? void 0 : _a.subjectName) || exam.subjectId}`,
                subject: ((_b = exam.subject) === null || _b === void 0 ? void 0 : _b.subjectName) || exam.subjectId,
                className: ((_c = exam.class) === null || _c === void 0 ? void 0 : _c.className) || exam.classId,
                date: exam.examDate ? exam.examDate.toISOString().split("T")[0] : null,
                time: exam.examTime || null,
                status: "Upcoming",
            });
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Upcoming exams fetched successfully.",
            data: {
                exams,
                pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
            },
        };
    }
    catch (error) {
        console.error("getUpcomingExams error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
const getExamProgress = (studentId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentProfile = yield Student_modal_1.default.findOne({
            where: { userId: studentId, instituteId },
            attributes: ["classId"],
        });
        if (!studentProfile) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Student profile not found." };
        }
        const { classId } = studentProfile;
        const period = query.period || "month";
        let dateFilter = {};
        const now = new Date();
        if (period === "month") {
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            dateFilter = { [sequelize_1.Op.gte]: startOfMonth };
        }
        else if (period === "semester") {
            const startOfSemester = now.getMonth() < 6
                ? new Date(now.getFullYear(), 0, 1)
                : new Date(now.getFullYear(), 6, 1);
            dateFilter = { [sequelize_1.Op.gte]: startOfSemester };
        }
        else if (period === "year") {
            const startOfYear = new Date(now.getFullYear(), 0, 1);
            dateFilter = { [sequelize_1.Op.gte]: startOfYear };
        }
        const totalAssigned = yield Exam_modal_1.default.count({
            where: { instituteId, classId, isDeleted: false, examDate: dateFilter },
        });
        const upcoming = yield Exam_modal_1.default.count({
            where: { instituteId, classId, isDeleted: false, status: "Live", examDate: { [sequelize_1.Op.gte]: new Date() } },
        });
        const studentEvals = yield AIEvaluation_modal_1.default.findAll({
            where: { studentId, status: "Success", createdAt: dateFilter },
            attributes: ["examId"],
            group: ["examId"],
        });
        const completed = studentEvals.length;
        const published = yield AIEvaluation_modal_1.default.count({
            where: { studentId, status: "Success", createdAt: dateFilter },
        });
        const rechecks = yield RecheckRequest_modal_1.default.count({
            where: { studentId, instituteId, status: { [sequelize_1.Op.in]: ["Pending", "Under Review"] }, createdAt: dateFilter },
        });
        const progress = [
            { label: "Upcoming Exams", value: (0, adminDashboard_helper_1.percentValue)(upcoming, totalAssigned), color: "#3564C7" },
            { label: "Completed Exams", value: (0, adminDashboard_helper_1.percentValue)(completed, totalAssigned), color: "#20A36A" },
            { label: "Results Published", value: (0, adminDashboard_helper_1.percentValue)(published, Math.max(completed, 1)), color: "#6C4CE6" },
            { label: "Recheck Requests", value: (0, adminDashboard_helper_1.percentValue)(rechecks, Math.max(published, 1)), color: "#F28A2B" },
        ];
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam progress fetched successfully.",
            data: { progress },
        };
    }
    catch (error) {
        console.error("getExamProgress error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
const getPerformanceOverview = (studentId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const period = query.period || "sixMonths";
        const now = new Date();
        let startDate;
        if (period === "semester") {
            startDate = now.getMonth() < 6
                ? new Date(now.getFullYear(), 0, 1)
                : new Date(now.getFullYear(), 6, 1);
        }
        else {
            startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        }
        const evaluations = yield AIEvaluation_modal_1.default.findAll({
            where: {
                studentId,
                status: "Success",
                createdAt: { [sequelize_1.Op.gte]: startDate },
            },
            attributes: [
                [(0, sequelize_1.fn)("DATE_TRUNC", "month", (0, sequelize_1.col)("createdAt")), "month"],
                [(0, sequelize_1.fn)("AVG", (0, sequelize_1.col)("totalScore")), "avgScore"],
            ],
            group: [(0, sequelize_1.fn)("DATE_TRUNC", "month", (0, sequelize_1.col)("createdAt"))],
            order: [[(0, sequelize_1.fn)("DATE_TRUNC", "month", (0, sequelize_1.col)("createdAt")), "ASC"]],
            raw: true,
        });
        const performance = evaluations.map((e) => {
            const date = new Date(e.month);
            return { month: adminDashboard_helper_1.MONTH_LABELS[date.getMonth()], score: Math.round(Number(e.avgScore) || 0) };
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Performance overview fetched successfully.",
            data: { performance },
        };
    }
    catch (error) {
        console.error("getPerformanceOverview error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
const getSubjectComparison = (studentId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentProfile = yield Student_modal_1.default.findOne({
            where: { userId: studentId, instituteId },
            attributes: ["classId", "sectionId"],
        });
        if (!studentProfile) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Student profile not found." };
        }
        const { classId, sectionId } = studentProfile;
        const period = query.period || "semester";
        let dateFilter = {};
        const now = new Date();
        if (period === "year") {
            dateFilter = { [sequelize_1.Op.gte]: new Date(now.getFullYear(), 0, 1) };
        }
        else {
            dateFilter = { [sequelize_1.Op.gte]: now.getMonth() < 6 ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), 6, 1) };
        }
        const yourScores = yield AIEvaluation_modal_1.default.findAll({
            where: { studentId, status: "Success", createdAt: dateFilter },
            attributes: ["subjectId", [(0, sequelize_1.fn)("AVG", (0, sequelize_1.col)("totalScore")), "avgScore"]],
            group: ["subjectId"],
            raw: true,
        });
        const classmates = yield Student_modal_1.default.findAll({
            where: { instituteId, classId, sectionId, isActive: true, userId: { [sequelize_1.Op.ne]: studentId } },
            attributes: ["userId"],
        });
        const classmateIds = classmates.map((s) => s.userId);
        const classAverages = yield AIEvaluation_modal_1.default.findAll({
            where: { studentId: { [sequelize_1.Op.in]: classmateIds }, status: "Success", createdAt: dateFilter },
            attributes: ["subjectId", [(0, sequelize_1.fn)("AVG", (0, sequelize_1.col)("totalScore")), "avgScore"]],
            group: ["subjectId"],
            raw: true,
        });
        const subjectIds = [...new Set([...yourScores.map((s) => s.subjectId), ...classAverages.map((s) => s.subjectId)])];
        const subjects = yield Subject_modal_1.default.findAll({ where: { subjectId: { [sequelize_1.Op.in]: subjectIds } }, attributes: ["subjectId", "subjectName"] });
        const subjectMap = new Map(subjects.map((s) => [s.subjectId, s.subjectName]));
        const yourScoreMap = new Map(yourScores.map((s) => [s.subjectId, Math.round(Number(s.avgScore) || 0)]));
        const classAvgMap = new Map(classAverages.map((s) => [s.subjectId, Math.round(Number(s.avgScore) || 0)]));
        const comparison = subjectIds.map((subjectId) => ({
            subject: subjectMap.get(subjectId) || subjectId,
            yourScore: yourScoreMap.get(subjectId) || 0,
            classAverage: classAvgMap.get(subjectId) || 0,
        }));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subject comparison fetched successfully.",
            data: { comparison },
        };
    }
    catch (error) {
        console.error("getSubjectComparison error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
const getLatestResults = (studentId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, parseInt(query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
        const offset = (page - 1) * limit;
        const { count, rows } = yield AIEvaluation_modal_1.default.findAndCountAll({
            where: { studentId, status: "Success" },
            include: [
                { model: Exam_modal_1.default, as: "exam", attributes: ["examId", "examType", "totalMarks"], required: false },
                { model: Subject_modal_1.default, as: "subject", attributes: ["subjectId", "subjectName"], required: true },
            ],
            order: [["createdAt", "DESC"]],
            limit,
            offset,
        });
        const results = rows.map((evaluation) => {
            var _a, _b, _c;
            const totalMarks = ((_a = evaluation.exam) === null || _a === void 0 ? void 0 : _a.totalMarks) || 100;
            const percentage = Math.round((Number(evaluation.totalScore) / totalMarks) * 100);
            const { grade, status } = (0, adminDashboard_helper_1.getGradeFromPercentage)(percentage);
            return {
                subject: ((_b = evaluation.subject) === null || _b === void 0 ? void 0 : _b.subjectName) || evaluation.subjectId,
                exam: ((_c = evaluation.exam) === null || _c === void 0 ? void 0 : _c.examType) || evaluation.examId,
                score: `${evaluation.totalScore}/${totalMarks}`,
                percentage: `${percentage}%`,
                grade,
                status,
            };
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Latest results fetched successfully.",
            data: {
                results,
                pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
            },
        };
    }
    catch (error) {
        console.error("getLatestResults error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
const getSubjectPerformance = (studentId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const evaluations = yield AIEvaluation_modal_1.default.findAll({
            where: { studentId, status: "Success" },
            include: [{ model: Subject_modal_1.default, as: "subject", attributes: ["subjectId", "subjectName"], required: true }],
            raw: false,
        });
        const examIds = [...new Set(evaluations.map((e) => e.examId).filter(Boolean))];
        const exams = examIds.length
            ? yield Exam_modal_1.default.findAll({ where: { examId: { [sequelize_1.Op.in]: examIds } }, attributes: ["examId", "totalMarks"], raw: true })
            : [];
        const examTotalMarksMap = new Map(exams.map((e) => [e.examId, e.totalMarks]));
        const subjectMap = new Map();
        for (const evaluation of evaluations) {
            const sid = evaluation.subjectId;
            const totalMarks = examTotalMarksMap.get(evaluation.examId) || 100;
            if (!subjectMap.has(sid)) {
                subjectMap.set(sid, { scores: [], totalMarks, subjectName: ((_a = evaluation.subject) === null || _a === void 0 ? void 0 : _a.subjectName) || sid });
            }
            subjectMap.get(sid).scores.push(Number(evaluation.totalScore));
        }
        const performance = Array.from(subjectMap.entries()).map(([subjectId, data], index) => {
            const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
            const percentage = Math.round((avgScore / data.totalMarks) * 100);
            const { grade } = (0, adminDashboard_helper_1.getGradeFromPercentage)(percentage);
            return Object.assign({ subject: data.subjectName, percentage,
                grade }, (0, adminDashboard_helper_1.getSubjectPerformanceStyle)(index));
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subject performance fetched successfully.",
            data: { performance },
        };
    }
    catch (error) {
        console.error("getSubjectPerformance error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
const STUDENT_ACTIVITY_STYLE = {
    RESULT_PUBLISHED: { icon: "Assessment", color: "#EC4D74", bg: "#FFF0F4" },
    EXAM_SCHEDULE_UPDATED: { icon: "AssignmentTurnedIn", color: "#22A06B", bg: "#EAF9F1" },
    EXAM_SCHEDULED: { icon: "AssignmentTurnedIn", color: "#22A06B", bg: "#EAF9F1" },
    RECHECK_SUBMITTED: { icon: "RateReview", color: "#F46A4D", bg: "#FFF1ED" },
    RECHECK_COMPLETED: { icon: "RateReview", color: "#F46A4D", bg: "#FFF1ED" },
    EXAM_ANNOUNCED: { icon: "Campaign", color: "#F2A900", bg: "#FFF7E5" },
};
const DEFAULT_STUDENT_ACTIVITY_STYLE = { icon: "Assessment", color: "#3564C7", bg: "#EAF2FF" };
const getRecentActivity = (studentId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const limit = Math.min(50, Math.max(1, parseInt(query.limit || "10", 10)));
        const activities = yield ActivityLog_modal_1.default.findAll({
            where: { userId: studentId, instituteId },
            order: [["createdAt", "DESC"]],
            limit,
        });
        const formatted = activities.map((a) => {
            var _a, _b;
            const style = STUDENT_ACTIVITY_STYLE[a.eventType] || DEFAULT_STUDENT_ACTIVITY_STYLE;
            return Object.assign({ title: ((_a = a.metadata) === null || _a === void 0 ? void 0 : _a.title) || String(a.eventType || "Activity").replace(/_/g, " "), description: ((_b = a.metadata) === null || _b === void 0 ? void 0 : _b.description) || `${a.entityType || "Activity"} ${a.entityId || ""} - ${a.status}`.trim(), time: (0, adminDashboard_helper_1.timeAgo)(a.createdAt) }, style);
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Recent activity fetched successfully.",
            data: { activities: formatted },
        };
    }
    catch (error) {
        console.error("getRecentActivity error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
const getRecheckRequests = (studentId, instituteId, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, parseInt(query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
        const offset = (page - 1) * limit;
        const { count, rows } = yield RecheckRequest_modal_1.default.findAndCountAll({
            where: { studentId, instituteId },
            include: [
                { model: Exam_modal_1.default, as: "exam", attributes: ["examId", "examType"], required: false },
                { model: Subject_modal_1.default, as: "subject", attributes: ["subjectId", "subjectName"], required: false },
            ],
            order: [["createdAt", "DESC"]],
            limit,
            offset,
        });
        const requests = rows.map((req) => {
            var _a, _b;
            return ({
                requestId: req.requestId,
                subject: ((_a = req.subject) === null || _a === void 0 ? void 0 : _a.subjectName) || req.subjectId,
                exam: ((_b = req.exam) === null || _b === void 0 ? void 0 : _b.examType) || req.examId,
                requestDate: (0, adminDashboard_helper_1.formatDate)(req.createdAt),
                completion: req.completedAt ? (0, adminDashboard_helper_1.formatDate)(req.completedAt) : null,
                status: req.status,
            });
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Recheck requests fetched successfully.",
            data: {
                requests,
                pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
            },
        };
    }
    catch (error) {
        console.error("getRecheckRequests error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
    }
});
exports.default = {
    getStudentDashboardOverview,
    getUpcomingExams,
    getExamProgress,
    getPerformanceOverview,
    getSubjectComparison,
    getLatestResults,
    getSubjectPerformance,
    getRecentActivity,
    getRecheckRequests,
};
