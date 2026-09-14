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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllEvents = exports.getEventsByMonth = exports.deleteEvent = exports.deleteEvents = exports.createExamSchedule = exports.updateEvent = exports.createEvent = void 0;
const http_status_1 = __importDefault(require("http-status"));
const AcademicCalendar_modal_1 = __importDefault(require("../modals/AcademicCalendar.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const Session_modal_1 = __importDefault(require("../modals/Session.modal"));
const sequelize_1 = require("../config/sequelize");
const sequelize_2 = require("sequelize");
const examTime_1 = require("../utils/examTime");
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
    var _a, _b, _c, _d, _e;
    try {
        const event = yield AcademicCalendar_modal_1.default.findOne({ where: { eventId, instituteId, isDeleted: false } });
        if (!event) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Event not found" };
        }
        const _f = data !== null && data !== void 0 ? data : {}, { shift } = _f, changes = __rest(_f, ["shift"]);
        // Exam papers (they have a class) are re-validated like new ones: date, times, shift, clashes.
        if (event.classId && (changes.eventDate !== undefined || changes.startTime !== undefined || changes.endTime !== undefined || shift !== undefined)) {
            const date = (_a = changes.eventDate) !== null && _a !== void 0 ? _a : toDateOnly(event.eventDate);
            if (!(0, examTime_1.isDateOnly)(date)) {
                return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: "Choose a valid exam date." };
            }
            const start = (0, examTime_1.parseTime)((_b = changes.startTime) !== null && _b !== void 0 ? _b : event.startTime);
            const end = (0, examTime_1.parseTime)((_c = changes.endTime) !== null && _c !== void 0 ? _c : event.endTime);
            if (start === null || end === null || end <= start) {
                return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: "End time must be after the start time." };
            }
            const currentShift = (0, examTime_1.readDetails)(event.description).shift;
            const nextShift = (_d = shift !== null && shift !== void 0 ? shift : currentShift) !== null && _d !== void 0 ? _d : (0, examTime_1.shiftFromTime)(start);
            if (!(0, examTime_1.isShift)(nextShift)) {
                return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: "Shift must be First Shift or Second Shift." };
            }
            const clash = yield findClassClash(instituteId, {
                classId: event.classId,
                date,
                start,
                end,
                shift: nextShift,
                excludeEventId: event.eventId,
            });
            if (clash) {
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: `${event.className ? `Class ${event.className}` : "This class"} already has ${clash.subjectName || clash.title} in the ${(_e = clash.shift) !== null && _e !== void 0 ? _e : "same shift"} on ${date}. Pick the other shift or another day.`,
                };
            }
            changes.eventDate = date;
            changes.startTime = (0, examTime_1.formatClock)(start);
            changes.endTime = (0, examTime_1.formatClock)(end);
            changes.duration = (0, examTime_1.formatMinutes)(end - start);
            changes.description = (0, examTime_1.writeDetails)(event.description, { shift: nextShift });
            changes.color = SHIFT_COLOR[nextShift];
        }
        // Identity fields of an exam paper are not changed through an edit.
        for (const key of ["instituteId", "createdBy", "eventId", "isDeleted", "classId", "sessionId", "subjectId"])
            delete changes[key];
        yield event.update(changes);
        return { error: false, statusCode: http_status_1.default.OK, message: "Exam paper updated.", data: event };
    }
    catch (error) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: error.message };
    }
});
exports.updateEvent = updateEvent;
// ─── Exam date sheet (bulk) ─────────────────────────────────────────────────
const SHIFT_COLOR = { "First Shift": "#4F6EF7", "Second Shift": "#0EA5E9" };
const MAX_BATCH = 300;
const toDateOnly = (value) => {
    if (!value)
        return null;
    if (typeof value === "string")
        return value.slice(0, 10);
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const typeKey = (value) => String(value !== null && value !== void 0 ? value : "").toLowerCase().replace(/[^a-z0-9]/g, "");
/**
 * One class, one day, one shift = one paper. A class may write a second paper the same day
 * in the other shift. Only when a shift cannot be known (very old events without times)
 * do overlapping times decide.
 */
const slotsClash = (a, b) => {
    if (a.classId !== b.classId || a.date !== b.date)
        return false;
    if (a.shift && b.shift)
        return a.shift === b.shift;
    if (a.start !== null && a.end !== null && b.start !== null && b.end !== null)
        return a.start < b.end && b.start < a.end;
    return false;
};
const eventSlot = (e) => {
    const start = (0, examTime_1.parseTime)(e.startTime);
    const end = (0, examTime_1.parseTime)(e.endTime);
    const shift = (0, examTime_1.readDetails)(e.description).shift;
    return {
        eventId: e.eventId,
        classId: e.classId,
        date: toDateOnly(e.eventDate),
        start,
        end,
        shift: (0, examTime_1.isShift)(shift) ? shift : (0, examTime_1.shiftFromTime)(e.startTime),
        subjectName: e.subjectName || "",
        title: e.title,
        time: [e.startTime, e.endTime].filter(Boolean).join(" – "),
    };
};
const findClassClash = (instituteId, slot) => __awaiter(void 0, void 0, void 0, function* () {
    var _g;
    const sameDay = yield AcademicCalendar_modal_1.default.findAll({
        where: { instituteId, isDeleted: false, classId: slot.classId, eventDate: slot.date },
    });
    return (_g = sameDay
        .filter((e) => e.eventId !== slot.excludeEventId)
        .map(eventSlot)
        .find((other) => slotsClash(slot, other))) !== null && _g !== void 0 ? _g : null;
});
/**
 * Publishes a date sheet: many papers (classes × subjects) in one go, all or nothing.
 * Names come from the database, not the client. Refused with the full problem list when
 * any paper is invalid, clashes with another paper of that class, or is already scheduled.
 */
const createExamSchedule = (items, instituteId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _h;
    try {
        if (!Array.isArray(items) || items.length === 0) {
            return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: "Add at least one subject to the date sheet." };
        }
        if (items.length > MAX_BATCH) {
            return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: `A date sheet can have at most ${MAX_BATCH} papers at a time.` };
        }
        const ids = (key) => Array.from(new Set(items.map((i) => { var _a; return String((_a = i === null || i === void 0 ? void 0 : i[key]) !== null && _a !== void 0 ? _a : ""); }).filter(Boolean)));
        const [sessions, classes, subjects] = yield Promise.all([
            Session_modal_1.default.findAll({ where: { instituteId, sessionId: { [sequelize_2.Op.in]: ids("sessionId") }, isDeleted: false } }),
            Class_modal_1.default.findAll({ where: { instituteId, classId: { [sequelize_2.Op.in]: ids("classId") } } }),
            Subject_modal_1.default.findAll({ where: { instituteId, subjectId: { [sequelize_2.Op.in]: ids("subjectId") }, isDeleted: false } }),
        ]);
        const sessionIds = new Set(sessions.map((s) => s.sessionId));
        const classById = new Map(classes.map((c) => [c.classId, c]));
        const subjectById = new Map(subjects.map((s) => [s.subjectId, s]));
        const problems = [];
        const rows = [];
        const slots = [];
        items.forEach((item, index) => {
            var _a, _b;
            const cls = classById.get(item === null || item === void 0 ? void 0 : item.classId);
            const subject = subjectById.get(item === null || item === void 0 ? void 0 : item.subjectId);
            const label = `${(_a = subject === null || subject === void 0 ? void 0 : subject.subjectName) !== null && _a !== void 0 ? _a : "Subject"}${cls ? ` (Class ${cls.className})` : ""}`;
            const fail = (message) => problems.push({ index, message: `${label}: ${message}` });
            if (!item || !sessionIds.has(item.sessionId))
                return fail("choose a session of your school.");
            if (!cls)
                return fail("class not found.");
            if (!subject || subject.classId !== cls.classId)
                return fail("this subject does not belong to the class.");
            const examType = String((_b = item.examType) !== null && _b !== void 0 ? _b : "").trim();
            if (!examType)
                return fail("choose the exam (e.g. Mid Term).");
            if (!(0, examTime_1.isDateOnly)(item.date))
                return fail("choose a valid date.");
            if (!(0, examTime_1.isShift)(item.shift))
                return fail("choose First Shift or Second Shift.");
            const start = (0, examTime_1.parseTime)(item.startTime);
            const end = (0, examTime_1.parseTime)(item.endTime);
            if (start === null || end === null)
                return fail("enter the start and end time.");
            if (end <= start)
                return fail("end time must be after the start time.");
            const slot = { classId: cls.classId, date: item.date, start, end, shift: item.shift, label };
            const twin = slots.find((s) => slotsClash(slot, s));
            if (twin)
                return fail(`clashes with ${twin.label} — both in the ${item.shift} on ${item.date}. Move one to the other shift or another day.`);
            slots.push(slot);
            rows.push({
                title: `${examType} - ${subject.subjectName} (${cls.className})`,
                description: (0, examTime_1.writeDetails)(null, { shift: item.shift }),
                eventDate: item.date,
                startTime: (0, examTime_1.formatClock)(start),
                endTime: (0, examTime_1.formatClock)(end),
                duration: (0, examTime_1.formatMinutes)(end - start),
                eventType: examType,
                color: SHIFT_COLOR[item.shift],
                instituteId,
                createdBy,
                sessionId: item.sessionId,
                classId: cls.classId,
                className: cls.className,
                subjectId: subject.subjectId,
                subjectName: subject.subjectName,
                _index: index,
            });
        });
        // Against what is already on the calendar.
        if (rows.length) {
            const existing = yield AcademicCalendar_modal_1.default.findAll({
                where: { instituteId, isDeleted: false, classId: { [sequelize_2.Op.in]: Array.from(new Set(rows.map((r) => r.classId))) } },
            });
            for (const row of rows) {
                const label = `${row.subjectName} (Class ${row.className})`;
                const duplicate = existing.find((e) => e.sessionId === row.sessionId &&
                    e.classId === row.classId &&
                    e.subjectId === row.subjectId &&
                    typeKey(e.eventType) === typeKey(row.eventType));
                if (duplicate) {
                    problems.push({
                        index: row._index,
                        message: `${label}: already scheduled for ${row.eventType} on ${toDateOnly(duplicate.eventDate)}. Edit that paper instead.`,
                    });
                    continue;
                }
                const slot = {
                    classId: row.classId,
                    date: row.eventDate,
                    start: (0, examTime_1.parseTime)(row.startTime),
                    end: (0, examTime_1.parseTime)(row.endTime),
                    shift: (0, examTime_1.readDetails)(row.description).shift,
                };
                const clash = existing.map(eventSlot).find((other) => slotsClash(slot, other));
                if (clash) {
                    problems.push({
                        index: row._index,
                        message: `${label}: Class ${row.className} already has ${clash.subjectName || clash.title} in the ${(_h = clash.shift) !== null && _h !== void 0 ? _h : "same shift"} on ${row.eventDate}. Pick the other shift or another day.`,
                    });
                }
            }
        }
        if (problems.length) {
            problems.sort((a, b) => a.index - b.index);
            return {
                error: true,
                // 409 whether the paper is invalid or clashes: the client shows one problem list either way.
                statusCode: http_status_1.default.CONFLICT,
                message: problems.length === 1 ? problems[0].message : `${problems.length} papers need attention before publishing.`,
                data: { problems },
            };
        }
        const created = yield sequelize_1.sequelize.transaction((transaction) => __awaiter(void 0, void 0, void 0, function* () { return AcademicCalendar_modal_1.default.bulkCreate(rows.map((_a) => {
            var { _index } = _a, row = __rest(_a, ["_index"]);
            return row;
        }), { transaction }); }));
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: `Date sheet published — ${created.length} ${created.length === 1 ? "paper" : "papers"} scheduled.`,
            data: { events: created },
        };
    }
    catch (error) {
        console.error("createExamSchedule Error:", error);
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: `Failed to publish the date sheet: ${error.message}` };
    }
});
exports.createExamSchedule = createExamSchedule;
/** Unschedules several papers at once (soft delete, like single delete). */
const deleteEvents = (eventIds, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const ids = Array.isArray(eventIds) ? eventIds.filter((id) => typeof id === "string" && id) : [];
        if (!ids.length) {
            return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: "Select at least one paper." };
        }
        const [count] = yield AcademicCalendar_modal_1.default.update({ isDeleted: true }, { where: { instituteId, isDeleted: false, eventId: { [sequelize_2.Op.in]: ids } } });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `${count} ${count === 1 ? "paper" : "papers"} unscheduled.`,
            data: { deleted: count },
        };
    }
    catch (error) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: error.message };
    }
});
exports.deleteEvents = deleteEvents;
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
                    [sequelize_2.Op.gte]: startDate,
                    [sequelize_2.Op.lte]: endDate,
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
