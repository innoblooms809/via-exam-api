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
const sequelize_1 = require("sequelize");
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const TeacherProfile_modal_1 = __importDefault(require("../modals/TeacherProfile.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const ScannerProfile_modal_1 = __importDefault(require("../modals/ScannerProfile.modal"));
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const ActivityLog_modal_1 = __importDefault(require("../modals/ActivityLog.modal"));
const adminDashboard_helper_1 = require("../utils/adminDashboard.helper");
const errorResult = (message = "Something went wrong.") => ({
    error: true,
    statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
    message,
});
const getOverview = (instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const [totalStudents, totalTeachers, totalClasses, totalExams, totalSubjects, totalScanners,] = yield Promise.all([
            Student_modal_1.default.count({ where: { instituteId } }),
            TeacherProfile_modal_1.default.count({ where: { instituteId } }),
            Class_modal_1.default.count({ where: { instituteId, isDeleted: false } }),
            Exam_modal_1.default.count({ where: { instituteId, isDeleted: false } }),
            Subject_modal_1.default.count({ where: { instituteId, isDeleted: false } }),
            ScannerProfile_modal_1.default.count({ where: { instituteId } }),
        ]);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Admin dashboard overview fetched successfully.",
            data: {
                totalStudents,
                totalTeachers,
                totalClasses,
                totalExams,
                totalSubjects,
                totalScanners,
            },
        };
    }
    catch (error) {
        console.error("getOverview error:", error);
        return errorResult();
    }
});
const getTeacherAnalytics = (instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const months = (0, adminDashboard_helper_1.getMonthBuckets)(6);
        const rangeStart = months[0].start;
        const instituteExams = yield Exam_modal_1.default.findAll({
            where: { instituteId, isDeleted: false },
            attributes: ["examId"],
            raw: true,
        });
        const examIds = instituteExams.map((exam) => exam.examId);
        const evaluationWhere = examIds.length ? { examId: { [sequelize_1.Op.in]: examIds } } : { examId: { [sequelize_1.Op.in]: [""] } };
        const [papers, sheets, evaluations, teachers, upcomingExamRows, totalStudents, activeStudents, pendingEvaluations, successfulReports, recentLogs, draftPapers, liveExams,] = yield Promise.all([
            QuestionPaper_modal_1.default.findAll({
                where: { instituteId, createdAt: { [sequelize_1.Op.gte]: rangeStart } },
                attributes: ["createdAt", "status", "examId"],
                raw: true,
            }),
            Scanner_modal_1.default.findAll({
                where: { instituteId, isDeleted: false, createdAt: { [sequelize_1.Op.gte]: rangeStart } },
                attributes: ["createdAt", "status"],
                raw: true,
            }),
            AIEvaluation_modal_1.default.findAll({
                where: Object.assign(Object.assign({}, evaluationWhere), { createdAt: { [sequelize_1.Op.gte]: rangeStart } }),
                attributes: ["createdAt", "status", "examId", "subjectId", "examType"],
                raw: true,
            }),
            TeacherProfile_modal_1.default.findAll({
                where: { instituteId },
                attributes: ["teacherType", "userId"],
                raw: true,
            }),
            Exam_modal_1.default.findAll({
                where: {
                    instituteId,
                    isDeleted: false,
                    status: { [sequelize_1.Op.in]: ["Live", "Draft"] },
                },
                include: [
                    { model: Subject_modal_1.default, as: "subject", attributes: ["subjectName"], required: false },
                    { model: Class_modal_1.default, as: "class", attributes: ["className"], required: false },
                    { model: User_modal_1.default, as: "teacher", attributes: ["userName"], required: false },
                ],
                order: [["createdAt", "DESC"]],
                limit: 6,
            }),
            Student_modal_1.default.count({ where: { instituteId } }),
            Student_modal_1.default.count({ where: { instituteId, isActive: true } }),
            AIEvaluation_modal_1.default.count({
                where: Object.assign(Object.assign({}, evaluationWhere), { status: { [sequelize_1.Op.in]: ["Pending", "Processing"] } }),
            }),
            AIEvaluation_modal_1.default.count({
                where: Object.assign(Object.assign({}, evaluationWhere), { status: { [sequelize_1.Op.in]: ["Success", "Evaluated"] } }),
            }),
            ActivityLog_modal_1.default.findAll({
                where: {
                    instituteId,
                    role: { [sequelize_1.Op.iLike]: "%teacher%" },
                },
                order: [["createdAt", "DESC"]],
                limit: 6,
            }).catch(() => []),
            QuestionPaper_modal_1.default.count({
                where: { instituteId, status: { [sequelize_1.Op.in]: ["DRAFT", "PENDING_APPROVAL"] } },
            }),
            Exam_modal_1.default.count({
                where: { instituteId, isDeleted: false, status: "Live" },
            }),
        ]);
        const paperDates = papers.map((row) => new Date(row.createdAt));
        const sheetDates = sheets.map((row) => new Date(row.createdAt));
        const reportDates = evaluations
            .filter((row) => ["Success", "Evaluated"].includes(String(row.status)))
            .map((row) => new Date(row.createdAt));
        const activityData = months.map((bucket) => ({
            month: bucket.month,
            questionPapers: (0, adminDashboard_helper_1.countInBucket)(paperDates, bucket),
            answerSheets: (0, adminDashboard_helper_1.countInBucket)(sheetDates, bucket),
            reports: (0, adminDashboard_helper_1.countInBucket)(reportDates, bucket),
        }));
        const roleCounts = teachers.reduce((acc, teacher) => {
            const key = teacher.teacherType || "Teacher";
            acc[key] = (acc[key] || 0) + 1;
            return acc;
        }, {});
        const roleData = Object.entries(roleCounts).map(([name, value], index) => ({
            name,
            value,
            color: (0, adminDashboard_helper_1.getRoleColor)(name, index),
        }));
        const upcomingExams = upcomingExamRows.map((exam, index) => {
            var _a, _b, _c;
            const style = (0, adminDashboard_helper_1.getExamStyle)(index);
            const subjectName = ((_a = exam.subject) === null || _a === void 0 ? void 0 : _a.subjectName) || "Subject";
            return Object.assign(Object.assign({ id: exam.id, subject: subjectName, className: ((_b = exam.class) === null || _b === void 0 ? void 0 : _b.className) || "-", teacher: ((_c = exam.teacher) === null || _c === void 0 ? void 0 : _c.userName) || "-", date: (0, adminDashboard_helper_1.formatDate)(exam.createdAt), status: exam.status === "Live" ? "Upcoming" : exam.status }, style), { icon: (0, adminDashboard_helper_1.getSubjectIcon)(subjectName) });
        });
        const attendance = (0, adminDashboard_helper_1.percentValue)(activeStudents, totalStudents);
        const kpiData = [
            {
                title: "Total Students",
                value: (0, adminDashboard_helper_1.formatCount)(totalStudents),
                icon: "Groups",
                bg: "#eff6ff",
                color: "#2563eb",
            },
            {
                title: "Attendance",
                value: `${attendance}%`,
                icon: "EventAvailable",
                bg: "#f0fdf4",
                color: "#16a34a",
            },
            {
                title: "Tasks Pending",
                value: (0, adminDashboard_helper_1.formatCount)(pendingEvaluations),
                icon: "TaskAlt",
                bg: "#fff7ed",
                color: "#3D5CE5",
            },
            {
                title: "Reports Generated",
                value: (0, adminDashboard_helper_1.formatCount)(successfulReports),
                icon: "Analytics",
                bg: "#f3e8ff",
                color: "#9333ea",
            },
        ];
        const activities = recentLogs.slice(0, 6).map((log) => ({
            title: String(log.eventType || "Activity").replace(/_/g, " "),
            subtitle: log.entityType ? `${log.entityType}${log.entityId ? ` - ${log.entityId}` : ""}` : "Teacher activity",
            time: (0, adminDashboard_helper_1.timeAgo)(log.createdAt),
            color: log.status === "FAILED" ? adminDashboard_helper_1.DASHBOARD_COLORS.RED : adminDashboard_helper_1.DASHBOARD_COLORS.BLUE,
        }));
        const totalSheets = sheets.length;
        const processedSheets = sheets.filter((row) => (0, adminDashboard_helper_1.mapSheetStatus)(row.status) === "Processed").length;
        const evaluationProgress = (0, adminDashboard_helper_1.percentValue)(processedSheets, totalSheets || 1);
        const paperProgress = papers.length
            ? (0, adminDashboard_helper_1.percentValue)(papers.filter((row) => ["APPROVED", "PUBLISHED"].includes(row.status)).length, papers.length)
            : 0;
        const upcomingWork = [
            {
                title: "Answer Sheet Evaluation",
                progress: evaluationProgress,
                color: "#2563eb",
            },
            {
                title: "Question Paper Drafts",
                progress: draftPapers ? Math.max(15, 100 - (0, adminDashboard_helper_1.percentValue)(draftPapers, papers.length || draftPapers)) : paperProgress,
                color: "#16a34a",
            },
            {
                title: "Live Exams In Progress",
                progress: liveExams ? Math.min(100, liveExams * 20) : 0,
                color: "#9333ea",
            },
        ];
        const questionPaperCount = papers.length;
        const evaluationCount = evaluations.length;
        const reportCount = reportDates.length;
        const recheckCount = evaluations.filter((row) => String(row.status) === "Failed").length;
        const activityMax = Math.max(questionPaperCount, evaluationCount, reportCount, recheckCount, 1);
        const examActivity = [
            {
                label: "Question Papers",
                value: questionPaperCount,
                percentage: (0, adminDashboard_helper_1.percentValue)(questionPaperCount, activityMax),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.BLUE,
            },
            {
                label: "Evaluations",
                value: evaluationCount,
                percentage: (0, adminDashboard_helper_1.percentValue)(evaluationCount, activityMax),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.GREEN,
            },
            {
                label: "Reports",
                value: reportCount,
                percentage: (0, adminDashboard_helper_1.percentValue)(reportCount, activityMax),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.INDIGO,
            },
            {
                label: "Rechecks",
                value: recheckCount,
                percentage: (0, adminDashboard_helper_1.percentValue)(recheckCount, activityMax),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.CYAN,
            },
        ];
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher analytics fetched successfully.",
            data: {
                activityData,
                roleData,
                upcomingExams,
                kpiData,
                quickActions: adminDashboard_helper_1.TEACHER_QUICK_ACTIONS,
                activities,
                upcomingWork,
                examActivity,
            },
        };
    }
    catch (error) {
        console.error("getTeacherAnalytics error:", error);
        return errorResult();
    }
});
const getScannerAnalytics = (instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const months = (0, adminDashboard_helper_1.getMonthBuckets)(6);
        const rangeStart = months[0].start;
        const sheets = yield Scanner_modal_1.default.findAll({
            where: { instituteId, isDeleted: false },
            attributes: [
                "sheetId",
                "status",
                "createdAt",
                "uploadedBy",
                "classId",
                "subjectId",
                "examType",
            ],
            order: [["createdAt", "DESC"]],
        });
        const subjectIds = [...new Set(sheets.map((row) => row.subjectId).filter(Boolean))];
        const classIds = [...new Set(sheets.map((row) => row.classId).filter(Boolean))];
        const uploaderIds = [...new Set(sheets.map((row) => row.uploadedBy).filter(Boolean))];
        const [subjects, classes, uploaders] = yield Promise.all([
            subjectIds.length
                ? Subject_modal_1.default.findAll({
                    where: { subjectId: { [sequelize_1.Op.in]: subjectIds } },
                    attributes: ["subjectId", "subjectName"],
                })
                : [],
            classIds.length
                ? Class_modal_1.default.findAll({
                    where: { classId: { [sequelize_1.Op.in]: classIds } },
                    attributes: ["classId", "className"],
                })
                : [],
            uploaderIds.length
                ? User_modal_1.default.findAll({
                    where: { userId: { [sequelize_1.Op.in]: uploaderIds } },
                    attributes: ["userId", "userName"],
                })
                : [],
        ]);
        const subjectMap = Object.fromEntries(subjects.map((row) => [row.subjectId, row.subjectName]));
        const classMap = Object.fromEntries(classes.map((row) => [row.classId, row.className]));
        const userMap = Object.fromEntries(uploaders.map((row) => [row.userId, row.userName]));
        const monthlySheets = sheets.filter((row) => row.createdAt >= rangeStart);
        const activityData = months.map((bucket) => {
            const bucketSheets = monthlySheets.filter((row) => row.createdAt >= bucket.start && row.createdAt < bucket.end);
            const processed = bucketSheets.filter((row) => (0, adminDashboard_helper_1.mapSheetStatus)(row.status) === "Processed").length;
            const pending = bucketSheets.filter((row) => (0, adminDashboard_helper_1.mapSheetStatus)(row.status) === "Pending").length;
            const failed = bucketSheets.filter((row) => (0, adminDashboard_helper_1.mapSheetStatus)(row.status) === "Failed").length;
            return {
                month: bucket.month,
                sheets: bucketSheets.length,
                processed,
                pending,
                failed,
            };
        });
        const processed = sheets.filter((row) => (0, adminDashboard_helper_1.mapSheetStatus)(row.status) === "Processed").length;
        const pending = sheets.filter((row) => (0, adminDashboard_helper_1.mapSheetStatus)(row.status) === "Pending").length;
        const failed = sheets.filter((row) => (0, adminDashboard_helper_1.mapSheetStatus)(row.status) === "Failed").length;
        const total = sheets.length;
        const statusData = [
            {
                name: "Processed",
                value: processed,
                percentage: (0, adminDashboard_helper_1.percentLabel)(processed, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.GREEN,
            },
            {
                name: "Pending",
                value: pending,
                percentage: (0, adminDashboard_helper_1.percentLabel)(pending, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.AMBER,
            },
            {
                name: "Failed",
                value: failed,
                percentage: (0, adminDashboard_helper_1.percentLabel)(failed, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.RED,
            },
        ];
        const recentScans = sheets.slice(0, 6).map((row) => {
            const mappedStatus = (0, adminDashboard_helper_1.mapSheetStatus)(row.status);
            const subjectName = subjectMap[row.subjectId] || row.examType || "Subject";
            const style = mappedStatus === "Processed"
                ? { iconBg: "#EAFBF3", iconColor: adminDashboard_helper_1.DASHBOARD_COLORS.GREEN }
                : mappedStatus === "Failed"
                    ? { iconBg: "#FEF2F2", iconColor: adminDashboard_helper_1.DASHBOARD_COLORS.RED }
                    : { iconBg: "#F1ECFF", iconColor: adminDashboard_helper_1.DASHBOARD_COLORS.INDIGO };
            return Object.assign({ id: row.sheetId, subject: subjectName, className: classMap[row.classId] || "-", sheets: "1 sheet", scanner: userMap[row.uploadedBy] || "Scanner", date: (0, adminDashboard_helper_1.formatDate)(row.createdAt), status: mappedStatus, icon: (0, adminDashboard_helper_1.getSubjectIcon)(subjectName) }, style);
        });
        const progressData = [
            {
                label: "Sheets Scanned",
                value: total,
                percentage: total ? 100 : 0,
                color: adminDashboard_helper_1.DASHBOARD_COLORS.BLUE,
            },
            {
                label: "Processed",
                value: processed,
                percentage: (0, adminDashboard_helper_1.percentValue)(processed, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.GREEN,
            },
            {
                label: "Pending",
                value: pending,
                percentage: (0, adminDashboard_helper_1.percentValue)(pending, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.AMBER,
            },
            {
                label: "Failed / Recheck",
                value: failed,
                percentage: (0, adminDashboard_helper_1.percentValue)(failed, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.RED,
            },
        ];
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Scanner analytics fetched successfully.",
            data: {
                activityData,
                statusData,
                recentScans,
                progressData,
            },
        };
    }
    catch (error) {
        console.error("getScannerAnalytics error:", error);
        return errorResult();
    }
});
const getStudentAnalytics = (instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const months = (0, adminDashboard_helper_1.getMonthBuckets)(6);
        const [exams, students] = yield Promise.all([
            Exam_modal_1.default.findAll({
                where: { instituteId, isDeleted: false },
                include: [
                    { model: Subject_modal_1.default, as: "subject", attributes: ["subjectName"], required: false },
                    { model: Class_modal_1.default, as: "class", attributes: ["className"], required: false },
                ],
                order: [["createdAt", "DESC"]],
            }),
            Student_modal_1.default.findAll({
                where: { instituteId },
                attributes: ["createdAt"],
                raw: true,
            }),
        ]);
        const examDates = exams.map((exam) => exam.createdAt);
        const studentDates = students.map((row) => new Date(row.createdAt));
        const examActivityData = months.map((bucket) => ({
            month: bucket.month,
            exams: (0, adminDashboard_helper_1.countInBucket)(examDates, bucket),
            students: (0, adminDashboard_helper_1.countInBucket)(studentDates, bucket),
        }));
        const completed = exams.filter((exam) => exam.status === "Completed").length;
        const ongoing = exams.filter((exam) => exam.status === "Live").length;
        const cancelled = exams.filter((exam) => String(exam.status).toLowerCase() === "cancelled").length;
        const upcoming = exams.filter((exam) => exam.status === "Draft").length;
        const total = exams.length;
        const examStatusData = [
            {
                name: "Completed",
                value: completed,
                percentage: (0, adminDashboard_helper_1.percentLabel)(completed, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.GREEN,
            },
            {
                name: "Upcoming",
                value: upcoming,
                percentage: (0, adminDashboard_helper_1.percentLabel)(upcoming, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.BLUE,
            },
            {
                name: "Ongoing",
                value: ongoing,
                percentage: (0, adminDashboard_helper_1.percentLabel)(ongoing, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.AMBER,
            },
            {
                name: "Cancelled",
                value: cancelled,
                percentage: (0, adminDashboard_helper_1.percentLabel)(cancelled, total),
                color: adminDashboard_helper_1.DASHBOARD_COLORS.RED,
            },
        ];
        const mapExamRow = (exam) => {
            var _a, _b;
            return ({
                id: exam.id,
                name: exam.examType || "Exam",
                class: ((_a = exam.class) === null || _a === void 0 ? void 0 : _a.className) || "-",
                subject: ((_b = exam.subject) === null || _b === void 0 ? void 0 : _b.subjectName) || "-",
                startDate: (0, adminDashboard_helper_1.formatDate)(exam.createdAt),
                endDate: (0, adminDashboard_helper_1.formatDate)(exam.updatedAt),
                status: (0, adminDashboard_helper_1.mapExamUiStatus)(exam.status),
            });
        };
        const recentExams = exams.filter((exam) => exam.status === "Completed").slice(0, 5).map(mapExamRow);
        const upcomingExams = exams
            .filter((exam) => ["Live", "Draft"].includes(exam.status))
            .slice(0, 5)
            .map(mapExamRow);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student analytics fetched successfully.",
            data: {
                examActivityData,
                examStatusData,
                recentExams,
                upcomingExams,
            },
        };
    }
    catch (error) {
        console.error("getStudentAnalytics error:", error);
        return errorResult();
    }
});
const getSuperAdminAnalytics = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const thisYear = now.getFullYear();
        const yearBuckets = (0, adminDashboard_helper_1.getYearMonthBuckets)(thisYear);
        const prevYearBuckets = (0, adminDashboard_helper_1.getYearMonthBuckets)(thisYear - 1);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const [institutes, totalStudents, prevStudents, totalExams, prevExams, evaluatedSheets, prevEvaluated, recentInstitutes,] = yield Promise.all([
            Institute_modal_1.default.findAll({
                where: { isDeleted: false },
                attributes: ["id", "instituteId", "instituteName", "city", "contactPersonName", "plan", "status", "createdAt"],
                order: [["createdAt", "DESC"]],
            }),
            Student_modal_1.default.count(),
            Student_modal_1.default.count({ where: { createdAt: { [sequelize_1.Op.lt]: thirtyDaysAgo } } }),
            Exam_modal_1.default.count({ where: { isDeleted: false } }),
            Exam_modal_1.default.count({ where: { isDeleted: false, createdAt: { [sequelize_1.Op.lt]: thirtyDaysAgo } } }),
            Scanner_modal_1.default.count({ where: { isDeleted: false, status: { [sequelize_1.Op.in]: ["Evaluated", "Processed"] } } }),
            Scanner_modal_1.default.count({
                where: {
                    isDeleted: false,
                    status: { [sequelize_1.Op.in]: ["Evaluated", "Processed"] },
                    createdAt: { [sequelize_1.Op.lt]: thirtyDaysAgo },
                },
            }),
            Institute_modal_1.default.findAll({
                where: { isDeleted: false },
                order: [["createdAt", "DESC"]],
                limit: 8,
            }),
        ]);
        const totalInstitutes = institutes.length;
        const activeInstitutes = institutes.filter((row) => row.status === 1).length;
        const prevInstitutes = institutes.filter((row) => row.createdAt < thirtyDaysAgo).length;
        const prevActive = institutes.filter((row) => row.status === 1 && row.createdAt < thirtyDaysAgo).length;
        const kpiData = [
            Object.assign({ title: "Total Institutes", value: (0, adminDashboard_helper_1.formatCount)(totalInstitutes), description: "Registered organizations", icon: "building", tone: "brand" }, (0, adminDashboard_helper_1.getTrend)(totalInstitutes - prevInstitutes + prevInstitutes, prevInstitutes)),
            Object.assign({ title: "Active Institutes", value: (0, adminDashboard_helper_1.formatCount)(activeInstitutes), description: "Currently active", icon: "check", tone: "success" }, (0, adminDashboard_helper_1.getTrend)(activeInstitutes, prevActive)),
            Object.assign({ title: "Total Students", value: (0, adminDashboard_helper_1.formatCount)(totalStudents), description: "Across platform", icon: "users", tone: "brand" }, (0, adminDashboard_helper_1.getTrend)(totalStudents, prevStudents)),
            Object.assign({ title: "Total Exams", value: (0, adminDashboard_helper_1.formatCount)(totalExams), description: "Conducted this year", icon: "clipboard", tone: "warning" }, (0, adminDashboard_helper_1.getTrend)(totalExams, prevExams)),
            Object.assign({ title: "Evaluated", value: (0, adminDashboard_helper_1.formatCount)(evaluatedSheets), description: "AI checked sheets", icon: "cpu", tone: "success" }, (0, adminDashboard_helper_1.getTrend)(evaluatedSheets, prevEvaluated)),
        ];
        const prevYearStart = new Date(thisYear - 1, 0, 1);
        const examsThisYear = yield Exam_modal_1.default.findAll({
            where: { isDeleted: false, createdAt: { [sequelize_1.Op.gte]: prevYearStart } },
            attributes: ["createdAt"],
            raw: true,
        });
        const examDates = examsThisYear.map((row) => new Date(row.createdAt));
        const monthlyExamsData = yearBuckets.map((bucket) => ({
            month: bucket.month,
            exams: (0, adminDashboard_helper_1.countInBucket)(examDates, bucket),
        }));
        const revenueData = yearBuckets.map((bucket, index) => {
            const currentInstitutes = institutes.filter((row) => row.createdAt < bucket.end);
            const prevBucket = prevYearBuckets[index];
            const revenue = currentInstitutes.reduce((sum, row) => sum + (0, adminDashboard_helper_1.getPlanMonthlyRevenue)(row.plan), 0);
            const prev = institutes
                .filter((row) => row.createdAt < prevBucket.end)
                .reduce((sum, row) => sum + (0, adminDashboard_helper_1.getPlanMonthlyRevenue)(row.plan), 0);
            return {
                month: bucket.month,
                revenue: (0, adminDashboard_helper_1.toLakhs)(revenue),
                prev: (0, adminDashboard_helper_1.toLakhs)(prev),
            };
        });
        const instituteIds = recentInstitutes.map((row) => row.instituteId);
        const [examCounts, studentCounts] = yield Promise.all([
            Promise.all(instituteIds.map((instituteId) => Exam_modal_1.default.count({ where: { instituteId, isDeleted: false } }).then((count) => [instituteId, count]))),
            Promise.all(instituteIds.map((instituteId) => Student_modal_1.default.count({ where: { instituteId } }).then((count) => [instituteId, count]))),
        ]);
        const examCountMap = Object.fromEntries(examCounts);
        const studentCountMap = Object.fromEntries(studentCounts);
        const recentInstituteRows = recentInstitutes.map((row) => ({
            id: row.id,
            name: row.instituteName,
            city: row.city,
            admin: row.contactPersonName,
            exams: examCountMap[row.instituteId] || 0,
            students: studentCountMap[row.instituteId] || 0,
            status: row.status === 1 ? "Active" : "Pending",
            plan: row.plan || "Starter",
            revenue: (0, adminDashboard_helper_1.formatInrShort)((0, adminDashboard_helper_1.getPlanMonthlyRevenue)(row.plan)),
        }));
        const ytdRevenue = revenueData.reduce((sum, row) => sum + row.revenue, 0);
        const ytdExams = monthlyExamsData.reduce((sum, row) => sum + row.exams, 0);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Super admin analytics fetched successfully.",
            data: {
                kpiData,
                revenueData,
                monthlyExamsData,
                recentInstitutes: recentInstituteRows,
                ytdRevenue: Number(ytdRevenue.toFixed(1)),
                ytdExams,
            },
        };
    }
    catch (error) {
        console.error("getSuperAdminAnalytics error:", error);
        return errorResult();
    }
});
exports.default = {
    getOverview,
    getTeacherAnalytics,
    getScannerAnalytics,
    getStudentAnalytics,
    getSuperAdminAnalytics,
};
