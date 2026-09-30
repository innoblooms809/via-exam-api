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
exports.logActivity = void 0;
const crypto_1 = __importDefault(require("crypto"));
const ActivityLog_modal_1 = __importDefault(require("../modals/ActivityLog.modal"));
const UserPresenceSession_modal_1 = __importDefault(require("../modals/UserPresenceSession.modal"));
const logger_1 = __importDefault(require("../config/logger"));
/**
 * Production-grade helper to record user activity events & update presence session.
 * Operates safely without crashing the main request workflow.
 */
const logActivity = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { userId, role, instituteId = null, eventType, entityType = null, entityId = null, status = "SUCCESS", metadata = null, req, currentActivity, } = params;
        const eventId = `EVT-${Date.now()}-${crypto_1.default.randomBytes(4).toString("hex")}`;
        const ipAddress = req
            ? req.headers["x-forwarded-for"] || ((_a = req.socket) === null || _a === void 0 ? void 0 : _a.remoteAddress) || null
            : null;
        const userAgent = req ? req.headers["user-agent"] || null : null;
        // Log event using Winston Logger (Console & logs/combined.log file)
        logger_1.default.info(`[ACTIVITY_LOG] [${eventType}] User: ${userId} (${role}) | Institute: ${instituteId || "Global"} | Status: ${status} | IP: ${ipAddress || "Internal"}`);
        // Sanitize metadata to remove passwords, tokens, sensitive credentials
        let sanitizedMetadata = metadata ? Object.assign({}, metadata) : {};
        if (sanitizedMetadata.password)
            delete sanitizedMetadata.password;
        if (sanitizedMetadata.accessToken)
            delete sanitizedMetadata.accessToken;
        if (sanitizedMetadata.refreshToken)
            delete sanitizedMetadata.refreshToken;
        if (sanitizedMetadata.token)
            delete sanitizedMetadata.token;
        // 1. Create Immutable Activity Log Entry
        yield ActivityLog_modal_1.default.create({
            eventId,
            userId,
            role,
            instituteId,
            eventType,
            entityType,
            entityId,
            status,
            metadata: Object.keys(sanitizedMetadata).length > 0 ? sanitizedMetadata : null,
            ipAddress,
            userAgent,
        });
        // 2. Update/Upsert User Presence Session
        const now = new Date();
        let presenceStatus = "ONLINE";
        if (eventType === "LOGOUT" || eventType === "SESSION_EXPIRED") {
            presenceStatus = "OFFLINE";
        }
        else if (eventType === "USER_BLOCKED") {
            presenceStatus = "BLOCKED";
        }
        const activityDesc = currentActivity ||
            eventType
                .toLowerCase()
                .replace(/_/g, " ")
                .replace(/\b\w/g, (c) => c.toUpperCase());
        const existingSession = yield UserPresenceSession_modal_1.default.findOne({ where: { userId } });
        if (existingSession) {
            existingSession.role = role;
            if (instituteId)
                existingSession.instituteId = instituteId;
            existingSession.presenceStatus = presenceStatus;
            existingSession.lastActivityAt = now;
            existingSession.currentActivity = activityDesc;
            if (eventType === "LOGIN_SUCCESS")
                existingSession.lastLoginAt = now;
            if (eventType === "LOGOUT")
                existingSession.lastLogoutAt = now;
            if (ipAddress)
                existingSession.ipAddress = ipAddress;
            if (userAgent)
                existingSession.deviceInfo = userAgent.slice(0, 200);
            yield existingSession.save();
        }
        else {
            yield UserPresenceSession_modal_1.default.create({
                userId,
                role,
                instituteId,
                presenceStatus,
                currentActivity: activityDesc,
                lastActivityAt: now,
                lastLoginAt: eventType === "LOGIN_SUCCESS" ? now : undefined,
                lastLogoutAt: eventType === "LOGOUT" ? now : undefined,
                deviceInfo: userAgent ? userAgent.slice(0, 200) : null,
                ipAddress,
            });
        }
    }
    catch (err) {
        console.error("Failed to log activity event:", err.message);
    }
});
exports.logActivity = logActivity;
