"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
exports.getActivityLogs = exports.getUserDetailsAndTimeline = exports.getMonitoredUsers = exports.getMonitoringOverview = exports.getPlatformUsers = exports.getPlatformOverview = exports.cleanupStaleSessions = exports.recordHeartbeat = void 0;
const http_status_1 = __importDefault(require("http-status"));
const monitoringService = __importStar(require("../services/monitoring.service"));
const recordHeartbeat = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const result = yield monitoringService.recordHeartbeat(req.viaExamUser, (_a = req.body) === null || _a === void 0 ? void 0 : _a.currentActivity);
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.recordHeartbeat = recordHeartbeat;
const cleanupStaleSessions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield monitoringService.cleanupStaleSessions();
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.cleanupStaleSessions = cleanupStaleSessions;
// ── Platform-Wide (Super Admin Global — no institute filter) ──────────────────
const getPlatformOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield monitoringService.getPlatformOverview(req.query);
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.getPlatformOverview = getPlatformOverview;
const getPlatformUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield monitoringService.getPlatformUsers(req.query);
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.getPlatformUsers = getPlatformUsers;
// ── Institute-Scoped (Admin — scoped to user's institute) ────────────────────
const getMonitoringOverview = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield monitoringService.getInstituteOverview(req.viaExamUser, req.query, req);
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.getMonitoringOverview = getMonitoringOverview;
const getMonitoredUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield monitoringService.getInstituteUsers(req.viaExamUser, req.query, req);
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.getMonitoredUsers = getMonitoredUsers;
const getUserDetailsAndTimeline = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { userId } = req.params;
        const result = yield monitoringService.getUserDetailsAndTimeline(req.viaExamUser, userId, req);
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.getUserDetailsAndTimeline = getUserDetailsAndTimeline;
const getActivityLogs = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield monitoringService.getActivityLogs(req.viaExamUser, req.query, req);
        return res.status(result.statusCode).json(result);
    }
    catch (err) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        });
    }
});
exports.getActivityLogs = getActivityLogs;
