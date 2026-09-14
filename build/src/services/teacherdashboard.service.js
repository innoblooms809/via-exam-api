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
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const ActivityLog_modal_1 = __importDefault(require("../modals/ActivityLog.modal"));
const adminDashboard_helper_1 = require("../utils/adminDashboard.helper");
const errorResult = (message = "Something went wrong.") => ({
    error: true,
    statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
    message,
});
const getTeacherExamIds = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    const rows = yield Exam_modal_1.default.findAll({
        where: { teacherId, instituteId, isDeleted: false },
        attributes: ["examId", "status"],
        raw: true,
    });
    const examIds = rows.map((r) => r.examId);
    const examIdFilter = examIds.length ? { [sequelize_1.Op.in]: examIds } : { [sequelize_1.Op.in]: [""] };
    return { rows, examIds, examIdFilter };
});
// ─── OVERVIEW / KPIs ─────────────────────────────────────────────────────────
const getTeacherDashboardOverview = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { rows, examIdFilter } = yield getTeacherExamIds(teacherId, instituteId);
        const examsCreated = rows.length;
        const resultsPublished = rows.filter((r) => r.status === "Completed").length;
        const [questionPapersCreated, answerSheetsEvaluated] = yield Promise.all([
            QuestionPaper_modal_1.default.count({ where: { instituteId, teacherId, examId: examIdFilter } }),
            AIEvaluation_modal_1.default.count({ where: { examId: examIdFilter, status: "Success" } }),
        ]);
        const kpis = [
            { title: "Exams Created", value: (0, adminDashboard_helper_1.formatCount)(examsCreated), icon: "DescriptionOutlined", iconBg: "#e7f0ff", iconColor: "#3973c8" },
            { title: "Question Papers Created", value: (0, adminDashboard_helper_1.formatCount)(questionPapersCreated), icon: "AssignmentOutlined", iconBg: "#f0e9ff", iconColor: "#7e57c2" },
            { title: "Answer Sheets Evaluated", value: (0, adminDashboard_helper_1.formatCount)(answerSheetsEvaluated), icon: "FactCheckOutlined", iconBg: "#e3f7eb", iconColor: "#3c9a67" },
            { title: "Results Published", value: (0, adminDashboard_helper_1.formatCount)(resultsPublished), icon: "InsertChartOutlined", iconBg: "#fff0e8", iconColor: "#f07836" },
        ];
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher dashboard overview fetched successfully.",
            data: { kpis },
        };
    }
    catch (error) {
        console.error("getTeacherDashboardOverview error:", error);
        return errorResult();
    }
});
// ─── UPCOMING EXAMS ──────────────────────────────────────────────────────────
const getUpcomingExams = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const exams = yield Exam_modal_1.default.findAll({
            where: { teacherId, instituteId, isDeleted: false, status: { [sequelize_1.Op.in]: ["Live", "Draft"] }, examDate: { [sequelize_1.Op.gte]: today } },
            include: [
                { model: Subject_modal_1.default, as: "subject", attributes: ["subjectName"], required: false },
                { model: Class_modal_1.default, as: "class", attributes: ["className"], required: false },
            ],
            order: [["examDate", "ASC"], ["examTime", "ASC"]],
            limit: 8,
        });
        const upcomingExams = exams.map((exam, index) => {
            var _a, _b;
            const style = (0, adminDashboard_helper_1.getExamStyle)(index);
            const subjectName = ((_a = exam.subject) === null || _a === void 0 ? void 0 : _a.subjectName) || "Subject";
            return {
                name: `${exam.examType} - ${subjectName}`,
                subject: subjectName,
                className: ((_b = exam.class) === null || _b === void 0 ? void 0 : _b.className) || "-",
                date: (0, adminDashboard_helper_1.formatDate)(exam.examDate),
                time: exam.examTime || "-",
                status: exam.status === "Live" ? "Upcoming" : "Draft",
                color: style.chipColor,
                bg: style.chipBg,
            };
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Upcoming exams fetched successfully.",
            data: { upcomingExams },
        };
    }
    catch (error) {
        console.error("getUpcomingExams error:", error);
        return errorResult();
    }
});
// ─── EXAM ACTIVITY (funnel) ──────────────────────────────────────────────────
const getExamActivity = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { rows, examIdFilter } = yield getTeacherExamIds(teacherId, instituteId);
        const totalExams = rows.length || 1;
        const [papers, evaluations] = yield Promise.all([
            QuestionPaper_modal_1.default.findAll({ where: { instituteId, teacherId, examId: examIdFilter }, attributes: ["examId"], raw: true }),
            AIEvaluation_modal_1.default.findAll({ where: { examId: examIdFilter, status: "Success" }, attributes: ["examId"], raw: true }),
        ]);
        const examsWithPaper = new Set(papers.map((p) => p.examId)).size;
        const examsWithSuccessEval = new Set(evaluations.map((e) => e.examId)).size;
        const completedExams = rows.filter((r) => r.status === "Completed").length;
        const progress = [
            { label: "Exams Created", value: rows.length ? 100 : 0, color: "#3973c8" },
            { label: "Question Papers Created", value: (0, adminDashboard_helper_1.percentValue)(examsWithPaper, totalExams), color: "#3e9a69" },
            { label: "Answer Sheets Evaluated", value: (0, adminDashboard_helper_1.percentValue)(examsWithSuccessEval, totalExams), color: "#8558bd" },
            { label: "Results Published", value: (0, adminDashboard_helper_1.percentValue)(completedExams, totalExams), color: "#f07832" },
        ];
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam activity fetched successfully.",
            data: { progress },
        };
    }
    catch (error) {
        console.error("getExamActivity error:", error);
        return errorResult();
    }
});
// ─── ACTIVITY OVERVIEW (monthly line/bar charts) ─────────────────────────────
const getActivityOverview = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const months = (0, adminDashboard_helper_1.getMonthBuckets)(6);
        const rangeStart = months[0].start;
        const { examIdFilter } = yield getTeacherExamIds(teacherId, instituteId);
        const [papers, evaluations] = yield Promise.all([
            QuestionPaper_modal_1.default.findAll({ where: { instituteId, teacherId, createdAt: { [sequelize_1.Op.gte]: rangeStart } }, attributes: ["createdAt"], raw: true }),
            AIEvaluation_modal_1.default.findAll({ where: { examId: examIdFilter, createdAt: { [sequelize_1.Op.gte]: rangeStart } }, attributes: ["createdAt", "status"], raw: true }),
        ]);
        const paperDates = papers.map((p) => new Date(p.createdAt));
        const evalDates = evaluations.map((e) => new Date(e.createdAt));
        const reportDates = evaluations.filter((e) => e.status === "Success").map((e) => new Date(e.createdAt));
        const activityData = months.map((bucket) => ({
            month: bucket.month,
            questionPapers: (0, adminDashboard_helper_1.countInBucket)(paperDates, bucket),
            answerSheets: (0, adminDashboard_helper_1.countInBucket)(evalDates, bucket),
            reports: (0, adminDashboard_helper_1.countInBucket)(reportDates, bucket),
        }));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Activity overview fetched successfully.",
            data: { activityData },
        };
    }
    catch (error) {
        console.error("getActivityOverview error:", error);
        return errorResult();
    }
});
// ─── UPCOMING WORK ───────────────────────────────────────────────────────────
const getUpcomingWork = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examIdFilter } = yield getTeacherExamIds(teacherId, instituteId);
        const [evaluations, papers, liveExams] = yield Promise.all([
            AIEvaluation_modal_1.default.findAll({ where: { examId: examIdFilter }, attributes: ["status"], raw: true }),
            QuestionPaper_modal_1.default.findAll({ where: { instituteId, teacherId }, attributes: ["status"], raw: true }),
            Exam_modal_1.default.count({ where: { teacherId, instituteId, isDeleted: false, status: "Live" } }),
        ]);
        const totalEvaluations = evaluations.length;
        const successEvaluations = evaluations.filter((e) => e.status === "Success").length;
        const evaluationProgress = (0, adminDashboard_helper_1.percentValue)(successEvaluations, totalEvaluations || 1);
        const draftPapers = papers.filter((p) => p.status === "DRAFT").length;
        const paperProgress = papers.length
            ? (0, adminDashboard_helper_1.percentValue)(papers.filter((p) => ["APPROVED", "PUBLISHED"].includes(p.status)).length, papers.length)
            : 0;
        const upcomingWork = [
            { title: "Answer Sheet Evaluation", progress: evaluationProgress, color: "#3973c8" },
            { title: "Question Paper Drafts", progress: draftPapers ? Math.max(15, 100 - (0, adminDashboard_helper_1.percentValue)(draftPapers, papers.length || draftPapers)) : paperProgress, color: "#3e9a69" },
            { title: "Upcoming Exams Preparation", progress: liveExams ? Math.min(100, liveExams * 20) : 0, color: "#a8b1bf" },
        ];
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Upcoming work fetched successfully.",
            data: { upcomingWork },
        };
    }
    catch (error) {
        console.error("getUpcomingWork error:", error);
        return errorResult();
    }
});
// ─── EVALUATION STATUS (donut) ───────────────────────────────────────────────
const getEvaluationStatus = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examIdFilter } = yield getTeacherExamIds(teacherId, instituteId);
        const evaluations = yield AIEvaluation_modal_1.default.findAll({ where: { examId: examIdFilter }, attributes: ["status"], raw: true });
        const total = evaluations.length;
        const success = evaluations.filter((e) => e.status === "Success").length;
        const pending = evaluations.filter((e) => e.status === "Pending").length;
        const failed = evaluations.filter((e) => e.status === "Failed").length;
        const segments = [
            { value: (0, adminDashboard_helper_1.percentValue)(success, total || 1), color: adminDashboard_helper_1.DASHBOARD_COLORS.GREEN, label: "Evaluated" },
            { value: (0, adminDashboard_helper_1.percentValue)(pending, total || 1), color: adminDashboard_helper_1.DASHBOARD_COLORS.AMBER, label: "Pending" },
            { value: (0, adminDashboard_helper_1.percentValue)(failed, total || 1), color: adminDashboard_helper_1.DASHBOARD_COLORS.RED, label: "Recheck" },
        ];
        const legend = [
            { color: adminDashboard_helper_1.DASHBOARD_COLORS.GREEN, label: "Evaluated", value: String(success), percent: (0, adminDashboard_helper_1.percentLabel)(success, total) },
            { color: adminDashboard_helper_1.DASHBOARD_COLORS.AMBER, label: "Pending", value: String(pending), percent: (0, adminDashboard_helper_1.percentLabel)(pending, total) },
            { color: adminDashboard_helper_1.DASHBOARD_COLORS.RED, label: "Recheck", value: String(failed), percent: (0, adminDashboard_helper_1.percentLabel)(failed, total) },
        ];
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Evaluation status fetched successfully.",
            data: { center: String(total), centerLabel: "Total Answers", segments, legend },
        };
    }
    catch (error) {
        console.error("getEvaluationStatus error:", error);
        return errorResult();
    }
});
// ─── SUBJECT WORKLOAD (donut) ────────────────────────────────────────────────
const getSubjectWorkload = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { examIdFilter } = yield getTeacherExamIds(teacherId, instituteId);
        const evaluations = yield AIEvaluation_modal_1.default.findAll({ where: { examId: examIdFilter }, attributes: ["subjectId"], raw: true });
        const total = evaluations.length;
        const countsBySubject = new Map();
        evaluations.forEach((e) => countsBySubject.set(e.subjectId, (countsBySubject.get(e.subjectId) || 0) + 1));
        const subjectIds = [...countsBySubject.keys()];
        const subjects = subjectIds.length
            ? yield Subject_modal_1.default.findAll({ where: { subjectId: { [sequelize_1.Op.in]: subjectIds } }, attributes: ["subjectId", "subjectName"], raw: true })
            : [];
        const subjectMap = new Map(subjects.map((s) => [s.subjectId, s.subjectName]));
        const sortedSubjectIds = [...countsBySubject.entries()].sort((a, b) => b[1] - a[1]).map(([sid]) => sid);
        const segments = sortedSubjectIds.map((sid, index) => ({
            value: (0, adminDashboard_helper_1.percentValue)(countsBySubject.get(sid), total || 1),
            color: (0, adminDashboard_helper_1.getSubjectPerformanceStyle)(index).color,
            label: subjectMap.get(sid) || sid,
        }));
        const legend = sortedSubjectIds.map((sid, index) => ({
            color: (0, adminDashboard_helper_1.getSubjectPerformanceStyle)(index).color,
            label: subjectMap.get(sid) || sid,
            value: String(countsBySubject.get(sid)),
            percent: (0, adminDashboard_helper_1.percentLabel)(countsBySubject.get(sid), total),
        }));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subject workload fetched successfully.",
            data: { center: String(total), centerLabel: "Evaluations", segments, legend },
        };
    }
    catch (error) {
        console.error("getSubjectWorkload error:", error);
        return errorResult();
    }
});
// ─── RECENT ACTIVITY ─────────────────────────────────────────────────────────
const getRecentActivity = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const logs = yield ActivityLog_modal_1.default.findAll({
            where: { userId: teacherId, instituteId },
            order: [["createdAt", "DESC"]],
            limit: 6,
        });
        const activities = logs.map((log) => ({
            title: String(log.eventType || "Activity").replace(/_/g, " "),
            subtitle: log.entityType ? `${log.entityType}${log.entityId ? ` - ${log.entityId}` : ""}` : "Teacher activity",
            time: (0, adminDashboard_helper_1.timeAgo)(log.createdAt),
            color: log.status === "FAILED" ? adminDashboard_helper_1.DASHBOARD_COLORS.RED : adminDashboard_helper_1.DASHBOARD_COLORS.BLUE,
        }));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Recent activity fetched successfully.",
            data: { activities },
        };
    }
    catch (error) {
        console.error("getRecentActivity error:", error);
        return errorResult();
    }
});
exports.default = {
    getTeacherDashboardOverview,
    getUpcomingExams,
    getExamActivity,
    getActivityOverview,
    getUpcomingWork,
    getEvaluationStatus,
    getSubjectWorkload,
    getRecentActivity,
};
