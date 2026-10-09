import express from "express";
import config from "../../config/config";
import userRoutes from "./auth/user.route";
import accessRoutes from "./access/access.route";
import docsRoute from "./system/docs.route";
import instituteRoutes from "./institute/institute.route";
import teacherRoutes from "./teacher/teacher.route";
import examRoutes from "./exam/exam.route";
import questionPaperRoutes from "./question-paper/questionPaper.route";
import sessionRoutes from "./academic/session.route";
import classRoutes from "./academic/class.route";
import sectionRoutes from "./academic/section.route";
import subjectRoutes from "./academic/subject.route";
import scannerRoutes from "./scanner/scanner.route";
import scannerUserRoutes from "./scanner/scannerUser.route";
import studentRoutes from "./student/student.route";
import { session } from "passport";
import standeranswerRoutes from "./question-paper/standardAnswer.route";
import healthRoutes from "./system/health.route";
import academicCalendarRoutes from "./academic/academicCalendar.route";
import authRoutes from "./auth/auth.route";
import notificationRoutes from "./notification/notification.route";
import aiEvaluationRoutes from "./evaluation/aiEvaluation.route";
import dashboardRoutes from "./dashboard/dashboard.route";
import adminDashboardRoutes from "./dashboard/adminDashboard.route";
import teacherDashboardRoutes from "./teacher/teacherDashboard.route";
import studentDashboardRoutes from "./student/studentDashboard.route";
import scannerDashboardRoutes from "./scanner/scannerDashboard.route";
import monitoringRoutes from "./monitoring/monitoring.route";
import recheckRequestRoutes from "./evaluation/recheckRequest.route";
import evaluationAssignmentRoutes from "./evaluation/evaluationAssignment.route";
import subscriptionRoutes from "./subscription/subscription.route";
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
    path: "/scanner-dashboard",
    route: scannerDashboardRoutes,
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
    route: userRoutes,
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
  {
    path: "/monitoring",
    route: monitoringRoutes,
  },
  {
    path: "/recheck-requests",
    route: recheckRequestRoutes,
  },
  {
    path: "/evaluation-assignments",
    route: evaluationAssignmentRoutes,
  },
  {
    path: "/subscription",
    route: subscriptionRoutes,
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
