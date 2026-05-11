import express from "express";
import config from "../../config/config";
import userRoutes from "./user.route";
import accessRoutes from "./access.route";
import docsRoute from "./docs.route";
import instituteRoutes from "./institute.route";
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
