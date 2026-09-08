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
exports.getActivityLogs = exports.getUserDetailsAndTimeline = exports.getInstituteUsers = exports.getInstituteOverview = exports.getPlatformUsers = exports.getPlatformOverview = exports.recordHeartbeat = exports.cleanupStaleSessions = void 0;
const http_status_1 = __importDefault(require("http-status"));
const sequelize_1 = require("sequelize");
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const ActivityLog_modal_1 = __importDefault(require("../modals/ActivityLog.modal"));
const UserPresenceSession_modal_1 = __importDefault(require("../modals/UserPresenceSession.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const winstonLogReader_1 = require("../utils/winstonLogReader");
// Presence Thresholds (in milliseconds)
const ONLINE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes - auto mark offline after inactivity
const IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes
// ─── Helpers ─────────────────────────────────────────────────────────────────
const getSuperAdminRoleIds = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const roles = yield Role_modal_1.default.findAll({
            where: { role: { [sequelize_1.Op.iLike]: "%SUPER_ADMIN%" } },
            attributes: ["id"],
        });
        return roles.map((r) => r.id);
    }
    catch (err) {
        return [1];
    }
});
const resolveInstituteId = (requesterUser, query = {}, req) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    // 1. X-School-Slug header from frontend request interceptor
    const slug = (((_a = req === null || req === void 0 ? void 0 : req.headers) === null || _a === void 0 ? void 0 : _a["x-school-slug"]) || ((_b = req === null || req === void 0 ? void 0 : req.headers) === null || _b === void 0 ? void 0 : _b["x-tenant-slug"]));
    if (slug && !["super-admin", "auth", "api"].includes(slug.toLowerCase())) {
        const inst = yield Institute_modal_1.default.findOne({
            where: { slug: { [sequelize_1.Op.iLike]: slug } },
            attributes: ["instituteId"],
        });
        if (inst)
            return inst.instituteId;
    }
    // 2. Query parameter
    if ((query === null || query === void 0 ? void 0 : query.instituteId) && query.instituteId !== "ALL")
        return query.instituteId;
    // 3. User's own institute fallback
    const rawRole = ((_c = requesterUser === null || requesterUser === void 0 ? void 0 : requesterUser.role) === null || _c === void 0 ? void 0 : _c.role) || "";
    const normalizedRole = String(rawRole).toUpperCase().replace(/[\s_-]+/g, "_");
    if (normalizedRole === "ADMIN" || (requesterUser === null || requesterUser === void 0 ? void 0 : requesterUser.instituteId)) {
        return (requesterUser === null || requesterUser === void 0 ? void 0 : requesterUser.instituteId) || null;
    }
    return null;
});
const getRoleIds = (pattern) => __awaiter(void 0, void 0, void 0, function* () {
    const roles = yield Role_modal_1.default.findAll({
        where: { role: { [sequelize_1.Op.iLike]: `%${pattern}%` } },
        attributes: ["id"],
    });
    return roles.map((r) => r.id);
});
const computePresenceCounts = (sessions, onlineCutoff) => {
    let online = 0;
    sessions.forEach((s) => {
        if (s.presenceStatus === "ONLINE" && new Date(s.lastActivityAt) >= onlineCutoff) {
            online++;
        }
    });
    return { online };
};
const formatUserRow = (u, sessionMap, onlineCutoff) => {
    var _a, _b;
    const s = sessionMap.get(u.userId);
    let status = "OFFLINE";
    if (u.status === 2 || (s === null || s === void 0 ? void 0 : s.presenceStatus) === "BLOCKED") {
        status = "BLOCKED";
    }
    else if ((s === null || s === void 0 ? void 0 : s.presenceStatus) === "ONLINE") {
        // Check if user is actually online based on last activity time
        const lastAct = new Date(s.lastActivityAt).getTime();
        if (lastAct >= onlineCutoff) {
            status = "ONLINE";
        }
        else {
            // User was marked as ONLINE but hasn't been active recently, mark as OFFLINE
            status = "OFFLINE";
        }
    }
    else {
        // OFFLINE if session is OFFLINE, doesn't exist, or user is blocked
        status = "OFFLINE";
    }
    return {
        id: u.id,
        userId: u.userId,
        userName: u.userName,
        emailId: u.emailId,
        phoneNumber: u.phoneNumber,
        role: ((_a = u.role) === null || _a === void 0 ? void 0 : _a.role) || "N/A",
        instituteId: u.instituteId,
        instituteName: ((_b = u.institute) === null || _b === void 0 ? void 0 : _b.instituteName) || "Platform Global",
        status,
        lastLoginAt: u.lastLoginAt || (s === null || s === void 0 ? void 0 : s.lastLoginAt) || null,
        lastActivityAt: (s === null || s === void 0 ? void 0 : s.lastActivityAt) || u.updatedAt,
        currentActivity: status === "OFFLINE" ? "Logged Out" : ((s === null || s === void 0 ? void 0 : s.currentActivity) || "Active in Portal"),
        deviceInfo: (s === null || s === void 0 ? void 0 : s.deviceInfo) || null,
    };
};
// ─── Clean Up Stale Sessions ─────────────────────────────────────────────────────
const cleanupStaleSessions = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const now = new Date();
        const offlineCutoff = new Date(now.getTime() - ONLINE_THRESHOLD_MS);
        // Update all sessions that haven't been active recently to OFFLINE
        const [updatedCount] = yield UserPresenceSession_modal_1.default.update({
            presenceStatus: "OFFLINE",
            currentActivity: "Logged Out",
            lastLogoutAt: now,
        }, {
            where: {
                presenceStatus: "ONLINE",
                lastActivityAt: {
                    [sequelize_1.Op.lt]: offlineCutoff,
                },
            },
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Cleaned up ${updatedCount} stale sessions.`,
            data: { updatedCount },
        };
    }
    catch (err) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: err.message,
        };
    }
});
exports.cleanupStaleSessions = cleanupStaleSessions;
// ─── Record Heartbeat ─────────────────────────────────────────────────────────
const recordHeartbeat = (user, currentActivity) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    try {
        const userId = user.userId;
        const role = ((_d = user.role) === null || _d === void 0 ? void 0 : _d.role) || "USER";
        const instituteId = user.instituteId || null;
        const now = new Date();
        let session = yield UserPresenceSession_modal_1.default.findOne({ where: { userId } });
        if (session) {
            session.presenceStatus = "ONLINE";
            session.lastActivityAt = now;
            if (currentActivity)
                session.currentActivity = currentActivity;
            yield session.save();
        }
        else {
            session = yield UserPresenceSession_modal_1.default.create({
                userId, role, instituteId,
                presenceStatus: "ONLINE",
                currentActivity: currentActivity || "Active in Portal",
                lastActivityAt: now,
                lastLoginAt: now,
            });
        }
        return {
            error: false, statusCode: http_status_1.default.OK, message: "Heartbeat recorded.",
            data: { userId, status: session.presenceStatus, lastActivityAt: session.lastActivityAt },
        };
    }
    catch (err) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: err.message };
    }
});
exports.recordHeartbeat = recordHeartbeat;
// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM-WIDE (Super Admin Global — NO institute filter)
// Called from: /monitoring/platform/overview  &  /monitoring/platform/users
// ═══════════════════════════════════════════════════════════════════════════════
const getPlatformOverview = (query = {}) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const superAdminRoleIds = yield getSuperAdminRoleIds();
        const userWhere = { isDeleted: false, roleId: { [sequelize_1.Op.notIn]: superAdminRoleIds } };
        const presenceWhere = { role: { [sequelize_1.Op.notIn]: ["SUPER_ADMIN", "super_admin"] } };
        const now = Date.now();
        const onlineCutoff = new Date(now - ONLINE_THRESHOLD_MS);
        const totalUsers = yield User_modal_1.default.count({ where: userWhere });
        const activeSessions = yield UserPresenceSession_modal_1.default.findAll({ where: presenceWhere });
        const { online } = computePresenceCounts(activeSessions, onlineCutoff);
        const adminsCount = yield User_modal_1.default.count({ where: Object.assign(Object.assign({}, userWhere), { roleId: { [sequelize_1.Op.in]: yield getRoleIds("ADMIN") } }) });
        const teachersCount = yield User_modal_1.default.count({ where: Object.assign(Object.assign({}, userWhere), { roleId: { [sequelize_1.Op.in]: yield getRoleIds("TEACHER") } }) });
        const scannersCount = yield User_modal_1.default.count({ where: Object.assign(Object.assign({}, userWhere), { roleId: { [sequelize_1.Op.in]: yield getRoleIds("SCANNER") } }) });
        const studentsCount = yield User_modal_1.default.count({ where: Object.assign(Object.assign({}, userWhere), { roleId: { [sequelize_1.Op.in]: yield getRoleIds("STUDENT") } }) });
        return {
            error: false, statusCode: http_status_1.default.OK,
            message: "Platform overview fetched successfully.",
            data: {
                totalUsers,
                onlineUsers: online,
                offlineUsers: Math.max(0, totalUsers - online),
                activeAdmins: adminsCount,
                studentsCurrentlyExams: studentsCount,
                activeTeachers: teachersCount,
                scannersProcessing: scannersCount,
            },
        };
    }
    catch (err) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: err.message };
    }
});
exports.getPlatformOverview = getPlatformOverview;
const getPlatformUsers = (query = {}) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, parseInt(query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || "25", 10)));
        const offset = (page - 1) * limit;
        const superAdminRoleIds = yield getSuperAdminRoleIds();
        const userWhere = { isDeleted: false, roleId: { [sequelize_1.Op.notIn]: superAdminRoleIds } };
        if (query.search) {
            const s = `%${query.search.trim()}%`;
            userWhere[sequelize_1.Op.or] = [
                { userName: { [sequelize_1.Op.iLike]: s } },
                { emailId: { [sequelize_1.Op.iLike]: s } },
                { userId: { [sequelize_1.Op.iLike]: s } },
                { phoneNumber: { [sequelize_1.Op.iLike]: s } },
            ];
        }
        if (query.role && query.role !== "ALL") {
            const targetRole = yield Role_modal_1.default.findOne({ where: { role: { [sequelize_1.Op.iLike]: query.role } } });
            if (targetRole)
                userWhere.roleId = targetRole.id;
        }
        const { count, rows: users } = yield User_modal_1.default.findAndCountAll({
            where: userWhere,
            include: [
                { model: Role_modal_1.default, as: "role", attributes: ["id", "role", "roleDescription"] },
                { model: Institute_modal_1.default, as: "institute", attributes: ["id", "instituteId", "instituteName", "slug"] },
            ],
            order: [["updatedAt", "DESC"]],
            limit, offset,
        });
        const userIds = users.map((u) => u.userId);
        const sessions = yield UserPresenceSession_modal_1.default.findAll({ where: { userId: { [sequelize_1.Op.in]: userIds } } });
        const sessionMap = new Map();
        sessions.forEach((s) => sessionMap.set(s.userId, s));
        const now = Date.now();
        const formattedData = users.map((u) => formatUserRow(u, sessionMap, now - ONLINE_THRESHOLD_MS));
        let finalData = formattedData;
        if (query.status && query.status !== "ALL") {
            finalData = formattedData.filter((item) => item.status.toUpperCase() === query.status.toUpperCase());
        }
        return {
            error: false, statusCode: http_status_1.default.OK,
            message: "Platform users fetched successfully.",
            data: finalData,
            pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
        };
    }
    catch (err) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: err.message };
    }
});
exports.getPlatformUsers = getPlatformUsers;
// ═══════════════════════════════════════════════════════════════════════════════
// INSTITUTE-SCOPED (Admin / Institute pages — always scoped to an institute)
// Called from: /monitoring/overview  &  /monitoring/users
// ═══════════════════════════════════════════════════════════════════════════════
const getInstituteOverview = (requesterUser, query = {}, req) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const superAdminRoleIds = yield getSuperAdminRoleIds();
        const adminRoleIds = yield getRoleIds("ADMIN");
        const targetInstituteId = yield resolveInstituteId(requesterUser, query, req);
        if (!targetInstituteId) {
            return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: "Institute context is required." };
        }
        // Exclude both super admins and regular admins from institute monitoring
        const userWhere = {
            isDeleted: false,
            roleId: { [sequelize_1.Op.notIn]: [...superAdminRoleIds, ...adminRoleIds] },
            instituteId: targetInstituteId
        };
        const presenceWhere = {
            role: { [sequelize_1.Op.notIn]: ["SUPER_ADMIN", "super_admin", "ADMIN", "admin"] },
            instituteId: targetInstituteId
        };
        const now = Date.now();
        const onlineCutoff = new Date(now - ONLINE_THRESHOLD_MS);
        const totalUsers = yield User_modal_1.default.count({ where: userWhere });
        const activeSessions = yield UserPresenceSession_modal_1.default.findAll({ where: presenceWhere });
        const { online } = computePresenceCounts(activeSessions, onlineCutoff);
        const teachersCount = yield User_modal_1.default.count({ where: Object.assign(Object.assign({}, userWhere), { roleId: { [sequelize_1.Op.in]: yield getRoleIds("TEACHER") } }) });
        const scannersCount = yield User_modal_1.default.count({ where: Object.assign(Object.assign({}, userWhere), { roleId: { [sequelize_1.Op.in]: yield getRoleIds("SCANNER") } }) });
        const studentsCount = yield User_modal_1.default.count({ where: Object.assign(Object.assign({}, userWhere), { roleId: { [sequelize_1.Op.in]: yield getRoleIds("STUDENT") } }) });
        return {
            error: false, statusCode: http_status_1.default.OK,
            message: "Institute overview fetched successfully.",
            data: {
                totalUsers,
                onlineUsers: online,
                offlineUsers: Math.max(0, totalUsers - online),
                activeAdmins: 0,
                studentsCurrentlyExams: studentsCount,
                activeTeachers: teachersCount,
                scannersProcessing: scannersCount,
            },
        };
    }
    catch (err) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: err.message };
    }
});
exports.getInstituteOverview = getInstituteOverview;
const getInstituteUsers = (requesterUser, query = {}, req) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const page = Math.max(1, parseInt(query.page || "1", 10));
        const limit = Math.min(100, Math.max(1, parseInt(query.limit || "25", 10)));
        const offset = (page - 1) * limit;
        const superAdminRoleIds = yield getSuperAdminRoleIds();
        const adminRoleIds = yield getRoleIds("ADMIN");
        const targetInstituteId = yield resolveInstituteId(requesterUser, query, req);
        if (!targetInstituteId) {
            return { error: true, statusCode: http_status_1.default.BAD_REQUEST, message: "Institute context is required." };
        }
        // Exclude both super admins and regular admins from institute monitoring
        const userWhere = {
            isDeleted: false,
            roleId: { [sequelize_1.Op.notIn]: [...superAdminRoleIds, ...adminRoleIds] },
            instituteId: targetInstituteId
        };
        if (query.search) {
            const s = `%${query.search.trim()}%`;
            userWhere[sequelize_1.Op.or] = [
                { userName: { [sequelize_1.Op.iLike]: s } },
                { emailId: { [sequelize_1.Op.iLike]: s } },
                { userId: { [sequelize_1.Op.iLike]: s } },
                { phoneNumber: { [sequelize_1.Op.iLike]: s } },
            ];
        }
        if (query.role && query.role !== "ALL") {
            const targetRole = yield Role_modal_1.default.findOne({ where: { role: { [sequelize_1.Op.iLike]: query.role } } });
            if (targetRole)
                userWhere.roleId = targetRole.id;
        }
        const { count, rows: users } = yield User_modal_1.default.findAndCountAll({
            where: userWhere,
            include: [
                { model: Role_modal_1.default, as: "role", attributes: ["id", "role", "roleDescription"] },
                { model: Institute_modal_1.default, as: "institute", attributes: ["id", "instituteId", "instituteName", "slug"] },
            ],
            order: [["updatedAt", "DESC"]],
            limit, offset,
        });
        const userIds = users.map((u) => u.userId);
        const sessions = yield UserPresenceSession_modal_1.default.findAll({ where: { userId: { [sequelize_1.Op.in]: userIds } } });
        const sessionMap = new Map();
        sessions.forEach((s) => sessionMap.set(s.userId, s));
        const now = Date.now();
        const formattedData = users.map((u) => formatUserRow(u, sessionMap, now - ONLINE_THRESHOLD_MS));
        let finalData = formattedData;
        if (query.status && query.status !== "ALL") {
            finalData = formattedData.filter((item) => item.status.toUpperCase() === query.status.toUpperCase());
        }
        return {
            error: false, statusCode: http_status_1.default.OK,
            message: "Institute users fetched successfully.",
            data: finalData,
            pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
        };
    }
    catch (err) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: err.message };
    }
});
exports.getInstituteUsers = getInstituteUsers;
// ═══════════════════════════════════════════════════════════════════════════════
// SHARED — User Details & Activity Logs
// ═══════════════════════════════════════════════════════════════════════════════
const getUserDetailsAndTimeline = (requesterUser, targetUserId, req) => __awaiter(void 0, void 0, void 0, function* () {
    var _e, _f, _g, _h;
    try {
        const superAdminRoleIds = yield getSuperAdminRoleIds();
        const userWhere = { userId: targetUserId, isDeleted: false, roleId: { [sequelize_1.Op.notIn]: superAdminRoleIds } };
        // If institute admin, scope to their institute
        if (((_e = requesterUser === null || requesterUser === void 0 ? void 0 : requesterUser.role) === null || _e === void 0 ? void 0 : _e.role) === "ADMIN" && (requesterUser === null || requesterUser === void 0 ? void 0 : requesterUser.instituteId)) {
            userWhere.instituteId = requesterUser.instituteId;
        }
        const user = yield User_modal_1.default.findOne({
            where: userWhere,
            include: [
                { model: Role_modal_1.default, as: "role" },
                { model: Institute_modal_1.default, as: "institute" },
            ],
        });
        if (!user) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "User not found or access denied." };
        }
        const session = yield UserPresenceSession_modal_1.default.findOne({ where: { userId: targetUserId } });
        const dbLogs = yield ActivityLog_modal_1.default.findAll({
            where: { userId: targetUserId },
            order: [["createdAt", "DESC"]],
            limit: 50,
        });
        const winstonUserLogs = yield (0, winstonLogReader_1.readUserWinstonLogsByUserId)(targetUserId, 50);
        // Merge DB logs and Winston log entries seamlessly
        const mergedTimeline = [...dbLogs, ...winstonUserLogs].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        const roleName = ((_f = user.role) === null || _f === void 0 ? void 0 : _f.role) || "";
        let roleProgress = null;
        if (roleName.includes("TEACHER")) {
            const assignedExams = yield Exam_modal_1.default.count({ where: { teacherId: targetUserId, isDeleted: false } });
            const completedEvals = yield AIEvaluation_modal_1.default.count({ where: { status: "Success" } });
            const pendingEvals = yield AIEvaluation_modal_1.default.count({ where: { status: { [sequelize_1.Op.or]: ["Pending", "Processing"] } } });
            roleProgress = {
                type: "TEACHER", assignedExams,
                evaluationsCompleted: completedEvals, evaluationsPending: pendingEvals,
                completionPercentage: completedEvals + pendingEvals > 0
                    ? Math.round((completedEvals / (completedEvals + pendingEvals)) * 100) : 100,
            };
        }
        else if (roleName.includes("SCANNER")) {
            const uploadedSheets = yield AIEvaluation_modal_1.default.count();
            const processedSheets = yield AIEvaluation_modal_1.default.count({ where: { status: "Success" } });
            const failedSheets = yield AIEvaluation_modal_1.default.count({ where: { status: "Failed" } });
            roleProgress = {
                type: "SCANNER", totalUploaded: uploadedSheets,
                processed: processedSheets, failed: failedSheets,
                processingQueue: Math.max(0, uploadedSheets - processedSheets - failedSheets),
            };
        }
        else if (roleName.includes("STUDENT")) {
            roleProgress = {
                type: "STUDENT", examStatus: "N/A",
                currentExam: "N/A", questionsCompleted: 0, totalQuestions: 0, timeRemainingSeconds: 0,
            };
        }
        return {
            error: false, statusCode: http_status_1.default.OK,
            message: "User monitoring details fetched successfully.",
            data: {
                user: {
                    id: user.id, userId: user.userId, userName: user.userName,
                    emailId: user.emailId, phoneNumber: user.phoneNumber,
                    role: (_g = user.role) === null || _g === void 0 ? void 0 : _g.role, instituteName: ((_h = user.institute) === null || _h === void 0 ? void 0 : _h.instituteName) || "Platform Global",
                    createdAt: user.createdAt,
                },
                session: session ? {
                    status: session.presenceStatus, lastActivityAt: session.lastActivityAt,
                    lastLoginAt: session.lastLoginAt, lastLogoutAt: session.lastLogoutAt,
                    currentActivity: session.currentActivity, deviceInfo: session.deviceInfo,
                    ipAddress: session.ipAddress,
                } : null,
                timeline: mergedTimeline,
                roleProgress,
            },
        };
    }
    catch (err) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: err.message };
    }
});
exports.getUserDetailsAndTimeline = getUserDetailsAndTimeline;
const getActivityLogs = (requesterUser, query = {}, req) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const limit = parseInt(query.limit, 10) || 50;
        const roleFilter = query.role || "ALL";
        const statusFilter = query.status || "ALL";
        // Read live logs directly from Winston logs/combined.log file (Zero DB Load)
        const logs = yield (0, winstonLogReader_1.readLatestWinstonLogs)(limit, roleFilter, statusFilter);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Activity logs retrieved successfully from Winston stream.",
            data: logs,
            pagination: { page: 1, limit, total: logs.length, totalPages: 1 },
        };
    }
    catch (err) {
        return { error: true, statusCode: http_status_1.default.INTERNAL_SERVER_ERROR, message: err.message };
    }
});
exports.getActivityLogs = getActivityLogs;
