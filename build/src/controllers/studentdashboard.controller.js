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
const studentdashboard_service_1 = __importDefault(require("../services/studentdashboard.service"));
const getStudentDashboardOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getStudentDashboardOverview(studentId, instituteId);
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
const getUpcomingExams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getUpcomingExams(studentId, instituteId, req.query);
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
const getExamProgress = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getExamProgress(studentId, instituteId, req.query);
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
const getPerformanceOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getPerformanceOverview(studentId, instituteId, req.query);
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
const getSubjectComparison = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getSubjectComparison(studentId, instituteId, req.query);
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
const getLatestResults = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getLatestResults(studentId, instituteId, req.query);
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
const getSubjectPerformance = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getSubjectPerformance(studentId, instituteId);
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
const getRecentActivity = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getRecentActivity(studentId, instituteId, req.query);
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
const getRecheckRequests = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const studentId = req.viaExamUser.userId;
        const instituteId = req.viaExamUser.instituteId;
        const result = yield studentdashboard_service_1.default.getRecheckRequests(studentId, instituteId, req.query);
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
    getStudentDashboardOverview,
    getUpcomingExams,
    getExamProgress,
    getPerformanceOverview,
    getSubjectComparison,
    getLatestResults,
    getSubjectPerformance,
    getRecentActivity,
    getRecheckRequests,
};
