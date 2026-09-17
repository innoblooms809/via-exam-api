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
const sequelize_1 = require("sequelize");
const Session_modal_1 = __importDefault(require("../modals/Session.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const sequelize_2 = require("../config/sequelize");
const fail = (statusCode, message) => ({ error: true, statusCode, message });
// ─── Validation ───────────────────────────────────────────────────────────────
/** "2026-2027" (or "2026-27"); the second year must follow the first. */
const parseSessionName = (value) => {
    const name = String(value !== null && value !== void 0 ? value : "").replace(/\s+/g, "");
    const match = /^(\d{4})-(\d{2}|\d{4})$/.exec(name);
    if (!match)
        return null;
    const start = Number(match[1]);
    const end = match[2].length === 2 ? Number(String(start).slice(0, 2) + match[2]) : Number(match[2]);
    if (start < 1990 || start > 2100 || end !== start + 1)
        return null;
    return name;
};
const parseDate = (value) => {
    if (!value)
        return null;
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
};
const MAX_SESSION_DAYS = 550;
const validateSession = (name, start, end) => {
    const sessionName = parseSessionName(name);
    if (!sessionName)
        return { ok: false, message: "Session name must look like 2026-2027." };
    const startDate = parseDate(start);
    const endDate = parseDate(end);
    if (!startDate || !endDate)
        return { ok: false, message: "Start date and end date are required." };
    if (endDate <= startDate)
        return { ok: false, message: "End date must be after the start date." };
    if ((endDate.getTime() - startDate.getTime()) / 86400000 > MAX_SESSION_DAYS) {
        return { ok: false, message: "A session can be at most 18 months long." };
    }
    return { ok: true, sessionName, startDate, endDate };
};
/** Another session of the institute whose dates overlap these. */
const findOverlap = (instituteId, startDate, endDate, exceptId) => Session_modal_1.default.findOne({
    where: Object.assign({ instituteId, isDeleted: false, startDate: { [sequelize_1.Op.lt]: endDate }, endDate: { [sequelize_1.Op.gt]: startDate } }, (exceptId ? { sessionId: { [sequelize_1.Op.ne]: exceptId } } : {})),
});
const formatDay = (date) => new Date(date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
// ─── CREATE SESSION ───────────────────────────────────────────────────────────
const createSession = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    const instituteId = createdBy.instituteId;
    const checked = validateSession(body.sessionName, body.startDate, body.endDate);
    if (!checked.ok)
        return fail(http_status_1.default.BAD_REQUEST, checked.message);
    const { sessionName, startDate, endDate } = checked;
    const t = yield sequelize_2.sequelize.transaction();
    try {
        const institute = yield Institute_modal_1.default.findOne({ where: { instituteId, status: 1 } });
        if (!institute) {
            yield t.rollback();
            return fail(http_status_1.default.NOT_FOUND, "Institute not found or inactive.");
        }
        // The table keeps deleted sessions, so a deleted one with this name is brought back.
        const existing = yield Session_modal_1.default.findOne({ where: { instituteId, sessionName }, transaction: t });
        if (existing && !existing.isDeleted) {
            yield t.rollback();
            return fail(http_status_1.default.CONFLICT, `Session ${sessionName} already exists.`);
        }
        const overlap = yield findOverlap(instituteId, startDate, endDate, existing === null || existing === void 0 ? void 0 : existing.sessionId);
        if (overlap) {
            yield t.rollback();
            return fail(http_status_1.default.CONFLICT, `These dates overlap session ${overlap.sessionName} (${formatDay(overlap.startDate)} – ${formatDay(overlap.endDate)}).`);
        }
        const hasActive = yield Session_modal_1.default.count({ where: { instituteId, isDeleted: false, isActive: true }, transaction: t });
        const makeActive = body.isActive === true || body.isActive === "true" || hasActive === 0;
        if (makeActive) {
            yield Session_modal_1.default.update({ isActive: false }, { where: { instituteId, isDeleted: false }, transaction: t });
        }
        let session;
        if (existing) {
            session = yield existing.update({ startDate, endDate, isActive: makeActive, isDeleted: false }, { transaction: t });
        }
        else {
            session = yield Session_modal_1.default.create({
                sessionId: yield helper_1.default.generateUserId(),
                instituteId,
                sessionName,
                startDate,
                endDate,
                isActive: makeActive,
            }, { transaction: t });
        }
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: makeActive ? `Session ${sessionName} created and set as current.` : `Session ${sessionName} created.`,
            data: session,
        };
    }
    catch (e) {
        yield t.rollback();
        console.error(e);
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
    }
});
// ─── GET ALL SESSIONS ─────────────────────────────────────────────────────────
const getAllSessions = (createdBy, query) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { isActive = "" } = query;
        const instituteId = createdBy.instituteId;
        const where = { instituteId, isDeleted: false };
        if (isActive === "true")
            where.isActive = true;
        if (isActive === "false")
            where.isActive = false;
        const sessions = yield Session_modal_1.default.findAll({ where, order: [["startDate", "DESC"]] });
        // How much each session is used, so the UI can explain why one can't be deleted.
        const [studentRows, examRows] = yield Promise.all([
            Student_modal_1.default.findAll({
                attributes: ["session", [sequelize_2.sequelize.fn("COUNT", sequelize_2.sequelize.col("id")), "count"]],
                where: { instituteId },
                group: ["session"],
                raw: true,
            }),
            Exam_modal_1.default.findAll({
                attributes: ["sessionId", [sequelize_2.sequelize.fn("COUNT", sequelize_2.sequelize.col("id")), "count"]],
                where: { instituteId, isDeleted: false },
                group: ["sessionId"],
                raw: true,
            }),
        ]);
        const students = new Map(studentRows.map((r) => [r.session, Number(r.count)]));
        const exams = new Map(examRows.map((r) => [r.sessionId, Number(r.count)]));
        const rows = sessions.map((s) => {
            var _a, _b;
            return (Object.assign(Object.assign({}, s.toJSON()), { studentCount: (_a = students.get(s.sessionName)) !== null && _a !== void 0 ? _a : 0, examCount: (_b = exams.get(s.sessionId)) !== null && _b !== void 0 ? _b : 0 }));
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Sessions fetched successfully.",
            data: {
                sessions: rows,
                total: rows.length,
                activeSession: (_a = rows.find((s) => s.isActive)) !== null && _a !== void 0 ? _a : null,
            },
        };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
    }
});
// ─── GET ONE SESSION ──────────────────────────────────────────────────────────
const getSessionById = (sessionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const session = yield Session_modal_1.default.findOne({
            where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false },
        });
        if (!session)
            return fail(http_status_1.default.NOT_FOUND, "Session not found.");
        return { error: false, statusCode: http_status_1.default.OK, message: "Session fetched successfully.", data: session };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
    }
});
// ─── GET ACTIVE SESSION ───────────────────────────────────────────────────────
const getActiveSession = (createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const session = yield Session_modal_1.default.findOne({
            where: { instituteId: createdBy.instituteId, isActive: true, isDeleted: false },
        });
        if (!session)
            return fail(http_status_1.default.NOT_FOUND, "No active session found. Please create or activate a session.");
        return { error: false, statusCode: http_status_1.default.OK, message: "Active session fetched.", data: session };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
    }
});
// ─── ACTIVATE SESSION ─────────────────────────────────────────────────────────
// Deactivates all other sessions and activates this one
const activateSession = (sessionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    const t = yield sequelize_2.sequelize.transaction();
    try {
        const session = yield Session_modal_1.default.findOne({
            where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false },
            transaction: t,
        });
        if (!session) {
            yield t.rollback();
            return fail(http_status_1.default.NOT_FOUND, "Session not found.");
        }
        if (session.isActive) {
            yield t.rollback();
            return fail(http_status_1.default.BAD_REQUEST, `${session.sessionName} is already the current session.`);
        }
        yield Session_modal_1.default.update({ isActive: false }, { where: { instituteId: createdBy.instituteId, isDeleted: false }, transaction: t });
        yield session.update({ isActive: true }, { transaction: t });
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `${session.sessionName} is now the current session.`,
            data: session,
        };
    }
    catch (e) {
        yield t.rollback();
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
    }
});
// ─── UPDATE SESSION ───────────────────────────────────────────────────────────
// Name and dates can change; students keep the session by name, so a rename is carried over.
const updateSession = (sessionId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c, _d;
    const instituteId = createdBy.instituteId;
    const t = yield sequelize_2.sequelize.transaction();
    try {
        const session = yield Session_modal_1.default.findOne({ where: { sessionId, instituteId, isDeleted: false }, transaction: t });
        if (!session) {
            yield t.rollback();
            return fail(http_status_1.default.NOT_FOUND, "Session not found.");
        }
        const checked = validateSession((_b = body.sessionName) !== null && _b !== void 0 ? _b : session.sessionName, (_c = body.startDate) !== null && _c !== void 0 ? _c : session.startDate, (_d = body.endDate) !== null && _d !== void 0 ? _d : session.endDate);
        if (!checked.ok) {
            yield t.rollback();
            return fail(http_status_1.default.BAD_REQUEST, checked.message);
        }
        const { sessionName, startDate, endDate } = checked;
        const oldName = session.sessionName;
        if (sessionName !== oldName) {
            const taken = yield Session_modal_1.default.findOne({
                where: { instituteId, sessionName, sessionId: { [sequelize_1.Op.ne]: sessionId } },
                transaction: t,
            });
            if (taken) {
                yield t.rollback();
                return fail(http_status_1.default.CONFLICT, taken.isDeleted
                    ? `A deleted session named ${sessionName} exists. Create ${sessionName} again to restore it instead.`
                    : `Session ${sessionName} already exists.`);
            }
        }
        const overlap = yield findOverlap(instituteId, startDate, endDate, sessionId);
        if (overlap) {
            yield t.rollback();
            return fail(http_status_1.default.CONFLICT, `These dates overlap session ${overlap.sessionName} (${formatDay(overlap.startDate)} – ${formatDay(overlap.endDate)}).`);
        }
        yield session.update({ sessionName, startDate, endDate }, { transaction: t });
        if (sessionName !== oldName) {
            yield Student_modal_1.default.update({ session: sessionName }, { where: { instituteId, session: oldName }, transaction: t });
        }
        yield t.commit();
        return { error: false, statusCode: http_status_1.default.OK, message: `Session ${sessionName} updated.`, data: session };
    }
    catch (e) {
        yield t.rollback();
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
    }
});
// ─── DELETE SESSION ───────────────────────────────────────────────────────────
const deleteSession = (sessionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = createdBy.instituteId;
        const session = yield Session_modal_1.default.findOne({ where: { sessionId, instituteId, isDeleted: false } });
        if (!session)
            return fail(http_status_1.default.NOT_FOUND, "Session not found.");
        if (session.isActive) {
            return fail(http_status_1.default.BAD_REQUEST, "The current session can't be deleted. Make another session current first.");
        }
        const [students, exams] = yield Promise.all([
            Student_modal_1.default.count({ where: { instituteId, session: session.sessionName } }),
            Exam_modal_1.default.count({ where: { instituteId, sessionId, isDeleted: false } }),
        ]);
        if (students || exams) {
            const used = [students && `${students} student${students === 1 ? "" : "s"}`, exams && `${exams} exam${exams === 1 ? "" : "s"}`]
                .filter(Boolean)
                .join(" and ");
            return fail(http_status_1.default.CONFLICT, `${session.sessionName} can't be deleted because ${used} belong to it.`);
        }
        yield session.update({ isDeleted: true, isActive: false });
        return { error: false, statusCode: http_status_1.default.OK, message: `Session ${session.sessionName} deleted.`, data: {} };
    }
    catch (e) {
        return fail(http_status_1.default.INTERNAL_SERVER_ERROR, `Something went wrong: ${e.message}`);
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
