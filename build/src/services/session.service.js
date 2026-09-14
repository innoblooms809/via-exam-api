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
const Session_modal_1 = __importDefault(require("../modals/Session.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const sequelize_1 = require("../config/sequelize");
// ─── CREATE SESSION ───────────────────────────────────────────────────────────
const createSession = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const instituteId = createdBy.instituteId;
        // 1. Check institute exists
        const institute = yield Institute_modal_1.default.findOne({
            where: { instituteId, status: 1 },
        });
        if (!institute) {
            // await t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Institute not found or inactive.",
            };
        }
        // 2. Check duplicate session name
        const exists = yield Session_modal_1.default.findOne({
            where: { instituteId, sessionName: body.sessionName, isDeleted: false, },
        });
        if (exists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: `Session "${body.sessionName}" already exists.`,
            };
        }
        // 3. Validate dates
        const startDate = new Date(body.startDate);
        const endDate = new Date(body.endDate);
        if (endDate <= startDate) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "End date must be after start date.",
            };
        }
        // 4. If this session is set as active
        //    deactivate all other sessions of this institute
        if (body.isActive) {
            yield Session_modal_1.default.update({ isActive: false }, { where: { instituteId, isDeleted: false, }, transaction: t });
        }
        // 5. Create session
        const sessionId = yield helper_1.default.generateUserId();
        const session = yield Session_modal_1.default.create({
            sessionId,
            instituteId,
            sessionName: body.sessionName,
            startDate,
            endDate,
            isActive: (_a = body.isActive) !== null && _a !== void 0 ? _a : true,
        }, { transaction: t });
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Session created successfully.",
            data: session,
        };
    }
    catch (e) {
        yield t.rollback();
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET ALL SESSIONS ─────────────────────────────────────────────────────────
const getAllSessions = (createdBy, query) => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    try {
        const { isActive = "" } = query;
        const where = { instituteId: createdBy.instituteId, isDeleted: false, };
        if (isActive === "true")
            where.isActive = true;
        if (isActive === "false")
            where.isActive = false;
        const sessions = yield Session_modal_1.default.findAll({
            where,
            order: [["startDate", "DESC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Sessions fetched successfully.",
            data: {
                sessions,
                total: sessions.length,
                activeSession: (_b = sessions.find((s) => s.isActive)) !== null && _b !== void 0 ? _b : null,
            },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET ONE SESSION ──────────────────────────────────────────────────────────
const getSessionById = (sessionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const session = yield Session_modal_1.default.findOne({
            where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false, },
        });
        if (!session) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Session not found.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Session fetched successfully.",
            data: session,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET ACTIVE SESSION ───────────────────────────────────────────────────────
const getActiveSession = (createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const session = yield Session_modal_1.default.findOne({
            where: {
                instituteId: createdBy.instituteId,
                isActive: true,
                isDeleted: false,
            },
        });
        if (!session) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "No active session found. Please create or activate a session.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Active session fetched.",
            data: session,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── ACTIVATE SESSION ─────────────────────────────────────────────────────────
// Deactivates all other sessions and activates this one
const activateSession = (sessionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const session = yield Session_modal_1.default.findOne({
            where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false },
        });
        if (!session) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Session not found.",
            };
        }
        if (session.isActive) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Session is already active.",
            };
        }
        // Deactivate all sessions of this institute
        yield Session_modal_1.default.update({ isActive: false }, {
            where: {
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
            transaction: t,
        });
        // Activate this session
        yield session.update({ isActive: true }, { transaction: t });
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Session "${session.sessionName}" is now active.`,
            data: session,
        };
    }
    catch (e) {
        yield t.rollback();
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── UPDATE SESSION ───────────────────────────────────────────────────────────
const updateSession = (sessionId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _c;
    try {
        const session = yield Session_modal_1.default.findOne({
            where: { sessionId, instituteId: createdBy.instituteId, isDeleted: false, },
        });
        if (!session) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Session not found.",
            };
        }
        // Validate dates if provided
        const startDate = body.startDate ? new Date(body.startDate) : session.startDate;
        const endDate = body.endDate ? new Date(body.endDate) : session.endDate;
        if (endDate <= startDate) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "End date must be after start date.",
            };
        }
        yield session.update({
            sessionName: (_c = body.sessionName) !== null && _c !== void 0 ? _c : session.sessionName,
            startDate,
            endDate,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Session updated successfully.",
            data: session,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── DELETE SESSION ───────────────────────────────────────────────────────────
const deleteSession = (sessionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const session = yield Session_modal_1.default.findOne({
            where: {
                sessionId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        if (!session) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Session not found.",
            };
        }
        if (session.isActive) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Cannot delete active session. Deactivate it first.",
            };
        }
        yield session.update({
            isDeleted: true,
            isActive: false,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Session deleted successfully.",
            data: {},
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
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
