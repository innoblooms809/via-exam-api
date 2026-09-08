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
const Admindashboard_service_1 = __importDefault(require("../services/Admindashboard.service"));
const missingInstitute = (res) => res.status(http_status_1.default.BAD_REQUEST).json({
    error: true,
    statusCode: http_status_1.default.BAD_REQUEST,
    message: "Institute not found for this user.",
});
const handleResult = (req, res, runner) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const instituteId = (_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.instituteId;
        if (!instituteId) {
            return missingInstitute(res);
        }
        const result = yield runner(instituteId);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const getOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return handleResult(req, res, Admindashboard_service_1.default.getOverview);
});
const getTeacherAnalytics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return handleResult(req, res, Admindashboard_service_1.default.getTeacherAnalytics);
});
const getScannerAnalytics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return handleResult(req, res, Admindashboard_service_1.default.getScannerAnalytics);
});
const getStudentAnalytics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    return handleResult(req, res, Admindashboard_service_1.default.getStudentAnalytics);
});
const getSuperAdminAnalytics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield Admindashboard_service_1.default.getSuperAdminAnalytics();
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
exports.default = {
    getOverview,
    getTeacherAnalytics,
    getScannerAnalytics,
    getStudentAnalytics,
    getSuperAdminAnalytics,
};
