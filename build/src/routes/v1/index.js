"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = __importDefault(require("../../config/config"));
const user_route_1 = __importDefault(require("./auth/user.route"));
const access_route_1 = __importDefault(require("./access/access.route"));
const docs_route_1 = __importDefault(require("./system/docs.route"));
const institute_route_1 = __importDefault(require("./institute/institute.route"));
const teacher_route_1 = __importDefault(require("./teacher/teacher.route"));
const exam_route_1 = __importDefault(require("./exam/exam.route"));
const examWorkflow_route_1 = __importDefault(require("./exam/examWorkflow.route"));
const questionPaper_route_1 = __importDefault(require("./question-paper/questionPaper.route"));
const session_route_1 = __importDefault(require("./academic/session.route"));
const class_route_1 = __importDefault(require("./academic/class.route"));
const section_route_1 = __importDefault(require("./academic/section.route"));
const subject_route_1 = __importDefault(require("./academic/subject.route"));
const scanner_route_1 = __importDefault(require("./scanner/scanner.route"));
const scannerUser_route_1 = __importDefault(require("./scanner/scannerUser.route"));
const student_route_1 = __importDefault(require("./student/student.route"));
const standardAnswer_route_1 = __importDefault(require("./question-paper/standardAnswer.route"));
const health_route_1 = __importDefault(require("./system/health.route"));
const academicCalendar_route_1 = __importDefault(require("./academic/academicCalendar.route"));
const auth_route_1 = __importDefault(require("./auth/auth.route"));
const notification_route_1 = __importDefault(require("./notification/notification.route"));
const aiEvaluation_route_1 = __importDefault(require("./evaluation/aiEvaluation.route"));
const dashboard_route_1 = __importDefault(require("./dashboard/dashboard.route"));
const adminDashboard_route_1 = __importDefault(require("./dashboard/adminDashboard.route"));
const teacherDashboard_route_1 = __importDefault(require("./teacher/teacherDashboard.route"));
const studentDashboard_route_1 = __importDefault(require("./student/studentDashboard.route"));
const scannerDashboard_route_1 = __importDefault(require("./scanner/scannerDashboard.route"));
const home_route_1 = __importDefault(require("./dashboard/home.route"));
const monitoring_route_1 = __importDefault(require("./monitoring/monitoring.route"));
const recheckRequest_route_1 = __importDefault(require("./evaluation/recheckRequest.route"));
const evaluationAssignment_route_1 = __importDefault(require("./evaluation/evaluationAssignment.route"));
const subscription_route_1 = __importDefault(require("./subscription/subscription.route"));
const router = express_1.default.Router();
const defaultRoutes = [
    {
        path: "/user",
        route: user_route_1.default,
    },
    {
        path: "/access",
        route: access_route_1.default,
    },
    {
        path: "/institute",
        route: institute_route_1.default,
    },
    {
        path: "/dashboard",
        route: dashboard_route_1.default,
    },
    {
        path: "/admin-dashboard",
        route: adminDashboard_route_1.default,
    },
    {
        path: "/teacher-dashboard",
        route: teacherDashboard_route_1.default,
    },
    {
        path: "/student-dashboard",
        route: studentDashboard_route_1.default,
    },
    {
        path: "/scanner-dashboard",
        route: scannerDashboard_route_1.default,
    },
    {
        path: "/home",
        route: home_route_1.default,
    },
    {
        path: "/sessions",
        route: session_route_1.default,
    },
    {
        path: "/class",
        route: class_route_1.default,
    },
    {
        path: "/section",
        route: section_route_1.default,
    },
    {
        path: "/subject",
        route: subject_route_1.default,
    },
    {
        path: "/teacher",
        route: teacher_route_1.default,
    },
    {
        path: "/exam",
        route: exam_route_1.default,
    },
    {
        path: "/exam-workflow",
        route: examWorkflow_route_1.default,
    },
    {
        path: "/question-papers",
        route: questionPaper_route_1.default,
    },
    {
        path: "/question-paper-answers",
        route: standardAnswer_route_1.default,
    },
    {
        path: "/health",
        route: health_route_1.default,
    },
    {
        path: "/scanner",
        route: scanner_route_1.default,
    },
    {
        path: "/scanner-user",
        route: scannerUser_route_1.default,
    },
    {
        path: "/student",
        route: student_route_1.default,
    },
    {
        path: "/academic-calendar",
        route: academicCalendar_route_1.default,
    },
    {
        path: "/auth",
        route: user_route_1.default,
    },
    {
        path: "/auth",
        route: auth_route_1.default,
    },
    {
        path: "/notifications",
        route: notification_route_1.default,
    },
    {
        path: "/ai-evaluation",
        route: aiEvaluation_route_1.default,
    },
    {
        path: "/monitoring",
        route: monitoring_route_1.default,
    },
    {
        path: "/recheck-requests",
        route: recheckRequest_route_1.default,
    },
    {
        path: "/evaluation-assignments",
        route: evaluationAssignment_route_1.default,
    },
    {
        path: "/subscription",
        route: subscription_route_1.default,
    },
    // {
    //   path: '/captcha',
    //   route: captchaRoutes
    // }  
];
const devRoutes = [
    // routes available only in development mode
    {
        path: "/docs",
        route: docs_route_1.default,
    },
];
defaultRoutes.forEach((route) => {
    router.use(route.path, route.route);
});
/* istanbul ignore next */
if (config_1.default.env === "development") {
    devRoutes.forEach((route) => {
        router.use(route.path, route.route);
    });
}
exports.default = router;
