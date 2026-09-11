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
exports.getAllEvents = exports.getEventsByMonth = exports.deleteEvent = exports.updateEvent = exports.createEvent = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AcademicCalendar_modal_1 = __importDefault(require("../modals/AcademicCalendar.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const sequelize_1 = require("sequelize");
const createEvent = (data, instituteId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const event = yield AcademicCalendar_modal_1.default.create(Object.assign(Object.assign({}, data), { instituteId,
            createdBy }));
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Event created successfully",
            data: event,
        };
    }
    catch (error) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Failed to create event: ${error.message}`,
        };
    }
});
exports.createEvent = createEvent;
const updateEvent = (eventId, data, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const event = yield AcademicCalendar_modal_1.default.findOne({ where: { eventId, instituteId, isDeleted: false } });
        if (!event) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Event not found" };
        }
        yield event.update(data);
        return { error: false, statusCode: http_status_1.default.OK, message: "Event updated successfully", data: event };
    }
    catch (error) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: error.message };
    }
});
exports.updateEvent = updateEvent;
const deleteEvent = (eventId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const event = yield AcademicCalendar_modal_1.default.findOne({ where: { eventId, instituteId, isDeleted: false } });
        if (!event) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Event not found" };
        }
        yield event.update({ isDeleted: true });
        return { error: false, statusCode: http_status_1.default.OK, message: "Event deleted successfully" };
    }
    catch (error) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: error.message };
    }
});
exports.deleteEvent = deleteEvent;
const getEventsByMonth = (instituteId, year, month) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // MySQL handles string comparison on DATEONLY correctly. We can do month matching.
        const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
        const lastDay = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        const events = yield AcademicCalendar_modal_1.default.findAll({
            where: {
                instituteId,
                isDeleted: false,
                eventDate: {
                    [sequelize_1.Op.gte]: startDate,
                    [sequelize_1.Op.lte]: endDate,
                },
            },
            order: [["eventDate", "ASC"]],
        });
        const creatorIds = events.map(e => e.createdBy).filter(Boolean);
        const users = yield User_modal_1.default.findAll({
            where: { userId: creatorIds }
        });
        const userMap = users.reduce((acc, u) => {
            acc[u.userId] = u.userName;
            return acc;
        }, {});
        const mappedEvents = events.map(e => {
            const plain = e.toJSON();
            if (userMap[plain.createdBy]) {
                plain.createdBy = userMap[plain.createdBy];
            }
            return plain;
        });
        return { error: false, statusCode: http_status_1.default.OK, data: mappedEvents };
    }
    catch (error) {
        console.error("Error in getEventsByMonth service:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: error.message };
    }
});
exports.getEventsByMonth = getEventsByMonth;
const getAllEvents = (instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const events = yield AcademicCalendar_modal_1.default.findAll({
            where: { instituteId, isDeleted: false },
            order: [["eventDate", "ASC"]],
        });
        const creatorIds = events.map(e => e.createdBy).filter(Boolean);
        const users = yield User_modal_1.default.findAll({
            where: { userId: creatorIds }
        });
        const userMap = users.reduce((acc, u) => {
            acc[u.userId] = u.userName;
            return acc;
        }, {});
        const mappedEvents = events.map(e => {
            const plain = e.toJSON();
            if (userMap[plain.createdBy]) {
                plain.createdBy = userMap[plain.createdBy];
            }
            return plain;
        });
        return { error: false, statusCode: http_status_1.default.OK, data: mappedEvents };
    }
    catch (error) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: error.message };
    }
});
exports.getAllEvents = getAllEvents;
