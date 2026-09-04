import express from "express";
import config from "../../config/config";
import userRoutes from "./user.route";
import accessRoutes from "./access.route";
import docsRoute from "./docs.route";
import instituteRoutes from "./institute.route";
import teacherRoutes from "./teacher.route";
import examRoutes from "./exam.route";
import questionPaperRoutes from "./question-answer/questioPaper.route";
import sessionRoutes from "./session.route";
import classRoutes from "./class.route";
import sectionRoutes from "./section.route";
import subjectRoutes from "./subject.route";
import scannerRoutes from "./scanner.route";
import scannerUserRoutes from "./scannerUser.route";
import studentRoutes from "./student.route";
import { session } from "passport";
import standeranswerRoutes from "./question-answer/stander-answer.routes";
import healthRoutes from "./health.route";
import academicCalendarRoutes from "./academicCalendar.route";
import authRoutes from "./auth.route";
import notificationRoutes from "./notification.route";
import aiEvaluationRoutes from "./aiEvaluation.route";
import dashboardRoutes from "./dashboard.route";
import adminDashboardRoutes from "./Admindashboard.route";
import teacherDashboardRoutes from "./teacherdashboard.route";
import studentDashboardRoutes from "./studentdashboard.route";
const router = express.Router();

const defaultRoutes = [
  {
    path: "/user",
    route: userRoutes,
  },
  {
    path: "/access",
    route: accessRoutes,
  },
{
    path: "/institute",
    route: instituteRoutes,
  },
  {
    path: "/dashboard",
    route: dashboardRoutes,
  },
  {
    path: "/admin-dashboard",
    route: adminDashboardRoutes,
  },
  {
    path: "/teacher-dashboard",
    route: teacherDashboardRoutes,
  },
  {
    path: "/student-dashboard",
    route: studentDashboardRoutes,
  },
  {
    path: "/sessions",
    route: sessionRoutes,
  },
  {
    path: "/class",
    route: classRoutes,
  },
  {
    path: "/section",
    route: sectionRoutes,
  },
  {
    path: "/subject",
    route: subjectRoutes,
  },
  {
    path: "/teacher",
    route: teacherRoutes,
  },
  {
    path: "/exam",
    route: examRoutes,
  },
  {
    path: "/question-papers",
    route: questionPaperRoutes,
  },
  {
    path: "/question-paper-answers",
    route: standeranswerRoutes,
  },
  {
    path: "/health",
    route: healthRoutes,
  },
  {
    path: "/scanner",
    route: scannerRoutes,
  },
  {
    path: "/scanner-user",
    route: scannerUserRoutes,
  },
  {
    path: "/student",
    route: studentRoutes,
  },
  {
    path: "/academic-calendar",
    route: academicCalendarRoutes,
  },
  {
    path: "/auth",
    route: authRoutes,
  },
  {
    path: "/notifications",
    route: notificationRoutes,
  },
  {
    path: "/ai-evaluation",
    route: aiEvaluationRoutes,
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
    route: docsRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

/* istanbul ignore next */
if (config.env === "development") {
  devRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
}

export default router;
