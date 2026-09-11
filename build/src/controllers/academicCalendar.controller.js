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
const academicCalendarService = __importStar(require("../services/academicCalendar.service"));
const http_status_1 = __importDefault(require("http-status"));
const createEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const user = req.viaExamUser;
        const roleName = (_b = (_a = user.role) === null || _a === void 0 ? void 0 : _a.role) === null || _b === void 0 ? void 0 : _b.toLowerCase();
        const createdBy = user.userName;
        const instituteId = user.instituteId;
        // Teachers can also create events
        if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
            return res.status(http_status_1.default.FORBIDDEN).send({ error: true, message: "Only admins and teachers can create events" });
        }
        const response = yield academicCalendarService.createEvent(req.body, instituteId, createdBy);
        return res.status(response.statusCode).send(response);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).send({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const updateEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _c, _d;
    try {
        const user = req.viaExamUser;
        const roleName = (_d = (_c = user.role) === null || _c === void 0 ? void 0 : _c.role) === null || _d === void 0 ? void 0 : _d.toLowerCase();
        const instituteId = user.instituteId;
        const { eventId } = req.params;
        if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
            return res.status(http_status_1.default.FORBIDDEN).send({ error: true, message: "Only admins and teachers can update events" });
        }
        const response = yield academicCalendarService.updateEvent(eventId, req.body, instituteId);
        return res.status(response.statusCode).send(response);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).send({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const deleteEvent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _e, _f;
    try {
        const user = req.viaExamUser;
        const roleName = (_f = (_e = user.role) === null || _e === void 0 ? void 0 : _e.role) === null || _f === void 0 ? void 0 : _f.toLowerCase();
        const instituteId = user.instituteId;
        const { eventId } = req.params;
        if (roleName !== "super_admin" && roleName !== "admin" && roleName !== "teacher") {
            return res.status(http_status_1.default.FORBIDDEN).send({ error: true, message: "Only admins and teachers can delete events" });
        }
        const response = yield academicCalendarService.deleteEvent(eventId, instituteId);
        return res.status(response.statusCode).send(response);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).send({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const getAllEvents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.viaExamUser;
        const instituteId = user.instituteId;
        const response = yield academicCalendarService.getAllEvents(instituteId);
        return res.status(response.statusCode).send(response);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).send({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const getEventsByMonth = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = req.viaExamUser;
        const instituteId = user.instituteId;
        const { year, month } = req.query;
        if (!year || !month) {
            return res.status(http_status_1.default.BAD_REQUEST).send({ error: true, message: "Year and month query params are required" });
        }
        const response = yield academicCalendarService.getEventsByMonth(instituteId, parseInt(year, 10), parseInt(month, 10));
        return res.status(response.statusCode).send(response);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).send({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
exports.default = {
    createEvent,
    updateEvent,
    deleteEvent,
    getAllEvents,
    getEventsByMonth
};
