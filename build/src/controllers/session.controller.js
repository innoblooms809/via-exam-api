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
const session_service_1 = __importDefault(require("../services/session.service"));
// ─── CREATE ───────────────────────────────────────────────────────────────────
const createSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield session_service_1.default.createSession(req.body, req.viaExamUser);
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
// ─── GET ALL ──────────────────────────────────────────────────────────────────
const getAllSessions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield session_service_1.default.getAllSessions(req.viaExamUser, req.query);
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
// ─── GET ONE ──────────────────────────────────────────────────────────────────
const getSessionById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield session_service_1.default.getSessionById(req.params.sessionId, req.viaExamUser);
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
// ─── GET ACTIVE ───────────────────────────────────────────────────────────────
const getActiveSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield session_service_1.default.getActiveSession(req.viaExamUser);
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
// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
const activateSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield session_service_1.default.activateSession(req.params.sessionId, req.viaExamUser);
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
// ─── UPDATE ───────────────────────────────────────────────────────────────────
const updateSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield session_service_1.default.updateSession(req.params.sessionId, req.body, req.viaExamUser);
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
// ─── DELETE ───────────────────────────────────────────────────────────────────
const deleteSession = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield session_service_1.default.deleteSession(req.params.sessionId, req.viaExamUser);
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
    createSession,
    getAllSessions,
    getSessionById,
    getActiveSession,
    activateSession,
    updateSession,
    deleteSession,
};
