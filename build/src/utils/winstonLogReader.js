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
exports.readUserWinstonLogsByUserId = exports.readLatestWinstonLogs = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const readline_1 = __importDefault(require("readline"));
/**
 * High-performance log reader that streams the latest N lines from logs/combined.log
 * Executed in memory without touching the database.
 */
const readLatestWinstonLogs = (limit = 100, filterRole, filterStatus) => __awaiter(void 0, void 0, void 0, function* () {
    const logFilePath = path_1.default.resolve(process.cwd(), "logs", "combined.log");
    if (!fs_1.default.existsSync(logFilePath)) {
        return [];
    }
    return new Promise((resolve) => {
        const fileStream = fs_1.default.createReadStream(logFilePath, { encoding: "utf-8" });
        const rl = readline_1.default.createInterface({
            input: fileStream,
            crlfDelay: Infinity,
        });
        const lines = [];
        rl.on("line", (line) => {
            if (line.trim()) {
                lines.push(line);
            }
        });
        rl.on("close", () => {
            const parsedLogs = [];
            const total = lines.length;
            // Iterate in reverse (latest logs first)
            for (let i = total - 1; i >= 0 && parsedLogs.length < limit; i--) {
                try {
                    const raw = lines[i];
                    const entry = JSON.parse(raw);
                    const msg = entry.message || "";
                    if (filterRole && filterRole !== "ALL") {
                        const cleanFilterRole = filterRole.toUpperCase().replace(/[\s_-]+/g, "");
                        const entryRole = String(entry.role || msg).toUpperCase().replace(/[\s_-]+/g, "");
                        if (!entryRole.includes(cleanFilterRole)) {
                            continue;
                        }
                    }
                    // Format into clean ActivityLog presentation object
                    parsedLogs.push({
                        eventId: `LOG-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                        userId: entry.userId || extractUserIdFromMsg(msg) || "SYSTEM",
                        role: entry.role || extractRoleFromMsg(msg) || "SYSTEM",
                        eventType: entry.eventType || extractEventTypeFromMsg(msg) || "API_REQUEST",
                        currentActivity: msg.slice(0, 150),
                        ipAddress: entry.ip || extractIpFromMsg(msg) || "127.0.0.1",
                        createdAt: entry.timestamp || new Date().toISOString(),
                        status: entry.level === "error" ? "FAILED" : "SUCCESS",
                        source: "WINSTON_LOG_STREAM",
                    });
                }
                catch (e) {
                    // Ignore unparseable raw log lines
                }
            }
            resolve(parsedLogs);
        });
        rl.on("error", () => {
            resolve([]);
        });
    });
});
exports.readLatestWinstonLogs = readLatestWinstonLogs;
const extractUserIdFromMsg = (msg) => {
    const match = msg.match(/User:\s*([^\s|]+)/i);
    return match ? match[1] : null;
};
const extractRoleFromMsg = (msg) => {
    const match = msg.match(/\(([^)]+)\)/);
    return match ? match[1] : null;
};
const extractEventTypeFromMsg = (msg) => {
    if (msg.includes("LOGIN_SUCCESS"))
        return "LOGIN_SUCCESS";
    if (msg.includes("LOGOUT"))
        return "LOGOUT";
    if (msg.includes("401") || msg.includes("403"))
        return "UNAUTHORIZED_ACCESS";
    if (msg.includes("500") || msg.includes("error"))
        return "SYSTEM_ERROR";
    return "ACTIVE_API_REQUEST";
};
const extractIpFromMsg = (msg) => {
    const match = msg.match(/IP:\s*([^\s|]+)/i);
    return match ? match[1] : null;
};
/**
 * Reads Winston logs specifically filtered for a target userId
 */
const readUserWinstonLogsByUserId = (targetUserId, limit = 50) => __awaiter(void 0, void 0, void 0, function* () {
    const logFilePath = path_1.default.resolve(process.cwd(), "logs", "combined.log");
    if (!fs_1.default.existsSync(logFilePath))
        return [];
    return new Promise((resolve) => {
        const fileStream = fs_1.default.createReadStream(logFilePath, { encoding: "utf-8" });
        const rl = readline_1.default.createInterface({ input: fileStream, crlfDelay: Infinity });
        const matchingLogs = [];
        rl.on("line", (line) => {
            if (line.trim() && line.includes(targetUserId)) {
                try {
                    const entry = JSON.parse(line);
                    const msg = entry.message || "";
                    const evtType = entry.eventType || extractEventTypeFromMsg(msg);
                    matchingLogs.push({
                        eventId: entry.eventId || `WINSTON-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                        userId: targetUserId,
                        role: entry.role || extractRoleFromMsg(msg) || "USER",
                        eventType: evtType,
                        status: entry.level === "error" ? "FAILED" : "SUCCESS",
                        currentActivity: msg.slice(0, 150),
                        ipAddress: entry.ip || extractIpFromMsg(msg) || "127.0.0.1",
                        createdAt: entry.timestamp || new Date().toISOString(),
                        metadata: Object.assign({ rawMessage: msg, logLevel: entry.level || "info", source: "WINSTON_COMBINED_LOG" }, (entry.metadata || {})),
                    });
                }
                catch (e) { }
            }
        });
        rl.on("close", () => {
            resolve(matchingLogs.reverse().slice(0, limit));
        });
        rl.on("error", () => resolve([]));
    });
});
exports.readUserWinstonLogsByUserId = readUserWinstonLogsByUserId;
