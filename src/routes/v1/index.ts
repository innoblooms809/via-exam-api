import express from "express";
import config from "../../config/config";
import userRoutes from "./user.route";
import accessRoutes from "./access.route";
import docsRoute from "./docs.route";
import instituteRoutes from "./institute.route";
import teacherRoutes from "./teacher.route";
import examRoutes from "./exam.route";
import questionPaperRoutes from "./questioPaper.route";
import sessionRoutes from "./session.route";
import classRoutes from "./class.route";
import sectionRoutes from "./section.route";
import subjectRoutes from "./subject.route";
import { session } from "passport";
// import studentRoutes from './student.route'
// import captchaRoutes from './captcha.route'

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
