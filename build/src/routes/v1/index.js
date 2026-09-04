"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_1 = __importDefault(require("../../config/config"));
const user_route_1 = __importDefault(require("./user.route"));
const access_route_1 = __importDefault(require("./access.route"));
const docs_route_1 = __importDefault(require("./docs.route"));
const institute_route_1 = __importDefault(require("./institute.route"));
const teacher_route_1 = __importDefault(require("./teacher.route"));
const exam_route_1 = __importDefault(require("./exam.route"));
const questioPaper_route_1 = __importDefault(require("./question-answer/questioPaper.route"));
const session_route_1 = __importDefault(require("./session.route"));
const class_route_1 = __importDefault(require("./class.route"));
const section_route_1 = __importDefault(require("./section.route"));
const subject_route_1 = __importDefault(require("./subject.route"));
const scanner_route_1 = __importDefault(require("./scanner.route"));
const scannerUser_route_1 = __importDefault(require("./scannerUser.route"));
const student_route_1 = __importDefault(require("./student.route"));
const stander_answer_routes_1 = __importDefault(require("./question-answer/stander-answer.routes"));
const health_route_1 = __importDefault(require("./health.route"));
const academicCalendar_route_1 = __importDefault(require("./academicCalendar.route"));
const auth_route_1 = __importDefault(require("./auth.route"));
const notification_route_1 = __importDefault(require("./notification.route"));
const aiEvaluation_route_1 = __importDefault(require("./aiEvaluation.route"));
const monitoring_route_1 = __importDefault(require("./monitoring.route"));
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
        path: "/question-papers",
        route: questioPaper_route_1.default,
    },
    {
        path: "/question-paper-answers",
        route: stander_answer_routes_1.default,
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
