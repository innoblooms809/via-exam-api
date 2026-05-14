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
const questioPaper_route_1 = __importDefault(require("./questioPaper.route"));
// import studentRoutes from './student.route'  
// import captchaRoutes from './captcha.route'
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
    }
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
