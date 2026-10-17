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
const ActivityLog_model_1 = __importDefault(require("../models/ActivityLog.model"));
const UserPresenceSession_model_1 = __importDefault(require("../models/UserPresenceSession.model"));
const logger_1 = __importDefault(require("../config/logger"));
const SECRET_KEY = /pass(word)?|token|secret|otp|authorization|cookie|api[-_]?key/i;
const MAX_METADATA_CHARS = 8 * 1024;
/** Copy of a value with every secret-looking key removed, at any depth. */
const redactSecrets = (value, depth = 0) => {
    if (depth > 6 || value === null || typeof value !== "object")
        return value;
    if (Array.isArray(value))
        return value.slice(0, 50).map((v) => redactSecrets(v, depth + 1));
    const out = {};
    for (const [key, v] of Object.entries(value)) {
        if (!SECRET_KEY.test(key))
            out[key] = redactSecrets(v, depth + 1);
    }
    return out;
};
/**
 * Production-grade helper to record user activity events & update presence session.
 * Operates safely without crashing the main request workflow.
 */
const logActivity = (params) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    try {
        const { userId, role, instituteId = null, eventType, entityType = null, entityId = null, status = "SUCCESS", metadata = null, req, currentActivity, } = params;
        const eventId = `EVT-${Date.now()}-${crypto_1.default.randomBytes(4).toString("hex")}`;
        // X-Forwarded-For is "client, proxy1, proxy2": keep the client, and fit the
        // 64-char column (an over-long value used to make the insert fail silently).
        const forwarded = req ? String((_a = req.headers["x-forwarded-for"]) !== null && _a !== void 0 ? _a : "").split(",")[0].trim() : "";
        const ipAddress = req ? (forwarded || ((_b = req.socket) === null || _b === void 0 ? void 0 : _b.remoteAddress) || "").slice(0, 64) || null : null;
        const userAgent = req ? String((_c = req.headers["user-agent"]) !== null && _c !== void 0 ? _c : "").slice(0, 500) || null : null;
        // Log event using Winston Logger (Console & logs/combined.log file)
        logger_1.default.info(`[ACTIVITY_LOG] [${eventType}] User: ${userId} (${role}) | Institute: ${instituteId || "Global"} | Status: ${status} | IP: ${ipAddress || "Internal"}`);
        // Secrets are removed at any depth, and the stored payload is capped so one
        // noisy event can't bloat the table.
        const sanitizedMetadata = redactSecrets(metadata !== null && metadata !== void 0 ? metadata : {});
        if (JSON.stringify(sanitizedMetadata).length > MAX_METADATA_CHARS) {
            for (const key of Object.keys(sanitizedMetadata))
                delete sanitizedMetadata[key];
            sanitizedMetadata.truncated = true;
        }
        // 1. Create Immutable Activity Log Entry
        yield ActivityLog_model_1.default.create({
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
        const existingSession = yield UserPresenceSession_model_1.default.findOne({ where: { userId } });
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
            yield UserPresenceSession_model_1.default.create({
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
