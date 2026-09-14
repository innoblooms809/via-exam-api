import httpStatus from "http-status";
import { Op } from "sequelize";
import UserModal from "../modals/User.modal";
import Role from "../modals/Role.modal";
import Institute from "../modals/Institute.modal";
import ActivityLog from "../modals/ActivityLog.modal";
import UserPresenceSession from "../modals/UserPresenceSession.modal";
import Exam from "../modals/Exam.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import ScannerProfile from "../modals/ScannerProfile.modal";
import { readLatestWinstonLogs, readUserWinstonLogsByUserId } from "../utils/winstonLogReader";

// Presence Thresholds (in milliseconds)
const ONLINE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes - auto mark offline after inactivity
const IDLE_THRESHOLD_MS = 15 * 60 * 1000; // 15 minutes

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getSuperAdminRoleIds = async (): Promise<number[]> => {
  try {
    const roles = await Role.findAll({
      where: { role: { [Op.iLike]: "%SUPER_ADMIN%" } },
      attributes: ["id"],
    });
    return roles.map((r) => r.id);
  } catch (err) {
    return [1];
  }
};

const resolveInstituteId = async (requesterUser: any, query: any = {}, req?: any): Promise<string | null> => {
  // 1. X-School-Slug header from frontend request interceptor
  const slug = (req?.headers?.["x-school-slug"] || req?.headers?.["x-tenant-slug"]) as string | undefined;
  if (slug && !["super-admin", "auth", "api"].includes(slug.toLowerCase())) {
    const inst = await Institute.findOne({
      where: { slug: { [Op.iLike]: slug } },
      attributes: ["instituteId"],
    });
    if (inst) return inst.instituteId;
  }
  // 2. Query parameter
  if (query?.instituteId && query.instituteId !== "ALL") return query.instituteId;
  // 3. User's own institute fallback
  const rawRole = requesterUser?.role?.role || "";
  const normalizedRole = String(rawRole).toUpperCase().replace(/[\s_-]+/g, "_");
  if (normalizedRole === "ADMIN" || requesterUser?.instituteId) {
    return requesterUser?.instituteId || null;
  }
  return null;
};

const getRoleIds = async (pattern: string): Promise<number[]> => {
  const roles = await Role.findAll({
    where: { role: { [Op.iLike]: `%${pattern}%` } },
    attributes: ["id"],
  });
  return roles.map((r) => r.id);
};

const computePresenceCounts = (sessions: any[], onlineCutoff: Date) => {
  let online = 0;
  sessions.forEach((s) => {
    if (s.presenceStatus === "ONLINE" && new Date(s.lastActivityAt) >= onlineCutoff) {
      online++;
    }
  });
  return { online };
};

const formatUserRow = (u: any, sessionMap: Map<string, any>, onlineCutoff: number) => {
  const s = sessionMap.get(u.userId);
  let status: "ONLINE" | "OFFLINE" | "BLOCKED" = "OFFLINE";
  
  if (u.status === 2 || s?.presenceStatus === "BLOCKED") {
    status = "BLOCKED";
  } else if (s?.presenceStatus === "ONLINE") {
    // Check if user is actually online based on last activity time
    const lastAct = new Date(s.lastActivityAt).getTime();
    if (lastAct >= onlineCutoff) {
      status = "ONLINE";
    } else {
      // User was marked as ONLINE but hasn't been active recently, mark as OFFLINE
      status = "OFFLINE";
    }
  } else {
    // OFFLINE if session is OFFLINE, doesn't exist, or user is blocked
    status = "OFFLINE";
  }
  
  return {
    id: u.id,
    userId: u.userId,
    userName: u.userName,
    emailId: u.emailId,
    phoneNumber: u.phoneNumber,
    role: u.role?.role || "N/A",
    instituteId: u.instituteId,
    instituteName: u.institute?.instituteName || "Platform Global",
    status,
    lastLoginAt: u.lastLoginAt || s?.lastLoginAt || null,
    lastActivityAt: s?.lastActivityAt || u.updatedAt,
    currentActivity: status === "OFFLINE" ? "Logged Out" : (s?.currentActivity || "Active in Portal"),
    deviceInfo: s?.deviceInfo || null,
  };
};

// ─── Clean Up Stale Sessions ─────────────────────────────────────────────────────

export const cleanupStaleSessions = async (): Promise<any> => {
  try {
    const now = new Date();
    const offlineCutoff = new Date(now.getTime() - ONLINE_THRESHOLD_MS);
    
    // Update all sessions that haven't been active recently to OFFLINE
    const [updatedCount] = await UserPresenceSession.update(
      {
        presenceStatus: "OFFLINE",
        currentActivity: "Logged Out",
        lastLogoutAt: now,
      },
      {
        where: {
          presenceStatus: "ONLINE",
          lastActivityAt: {
            [Op.lt]: offlineCutoff,
          },
        },
      }
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Cleaned up ${updatedCount} stale sessions.`,
      data: { updatedCount },
    };
  } catch (err: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    };
  }
};

// ─── Record Heartbeat ─────────────────────────────────────────────────────────

export const recordHeartbeat = async (user: any, currentActivity?: string): Promise<any> => {
  try {
    const userId = user.userId;
    const role = user.role?.role || "USER";
    const instituteId = user.instituteId || null;
    const now = new Date();

    let session = await UserPresenceSession.findOne({ where: { userId } });
    if (session) {
      session.presenceStatus = "ONLINE";
      session.lastActivityAt = now;
      if (currentActivity) session.currentActivity = currentActivity;
      await session.save();
    } else {
      session = await UserPresenceSession.create({
        userId, role, instituteId,
        presenceStatus: "ONLINE",
        currentActivity: currentActivity || "Active in Portal",
        lastActivityAt: now,
        lastLoginAt: now,
      });
    }

    return {
      error: false, statusCode: httpStatus.OK, message: "Heartbeat recorded.",
      data: { userId, status: session.presenceStatus, lastActivityAt: session.lastActivityAt },
    };
  } catch (err: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: err.message };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLATFORM-WIDE (Super Admin Global — NO institute filter)
// Called from: /monitoring/platform/overview  &  /monitoring/platform/users
// ═══════════════════════════════════════════════════════════════════════════════

export const getPlatformOverview = async (query: any = {}): Promise<any> => {
  try {
    const superAdminRoleIds = await getSuperAdminRoleIds();
    const userWhere: any = { isDeleted: false, roleId: { [Op.notIn]: superAdminRoleIds } };
    const presenceWhere: any = { role: { [Op.notIn]: ["SUPER_ADMIN", "super_admin"] } };

    const now = Date.now();
    const onlineCutoff = new Date(now - ONLINE_THRESHOLD_MS);

    const totalUsers = await UserModal.count({ where: userWhere });
    const activeSessions = await UserPresenceSession.findAll({ where: presenceWhere });
    const { online } = computePresenceCounts(activeSessions, onlineCutoff);

    const adminsCount = await UserModal.count({ where: { ...userWhere, roleId: { [Op.in]: await getRoleIds("ADMIN") } } });
    const teachersCount = await UserModal.count({ where: { ...userWhere, roleId: { [Op.in]: await getRoleIds("TEACHER") } } });
    const scannersCount = await UserModal.count({ where: { ...userWhere, roleId: { [Op.in]: await getRoleIds("SCANNER") } } });
    const studentsCount = await UserModal.count({ where: { ...userWhere, roleId: { [Op.in]: await getRoleIds("STUDENT") } } });

    return {
      error: false, statusCode: httpStatus.OK,
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
  } catch (err: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: err.message };
  }
};

export const getPlatformUsers = async (query: any = {}): Promise<any> => {
  try {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "25", 10)));
    const offset = (page - 1) * limit;

    const superAdminRoleIds = await getSuperAdminRoleIds();
    const userWhere: any = { isDeleted: false, roleId: { [Op.notIn]: superAdminRoleIds } };

    if (query.search) {
      const s = `%${query.search.trim()}%`;
      userWhere[Op.or] = [
        { userName: { [Op.iLike]: s } },
        { emailId: { [Op.iLike]: s } },
        { userId: { [Op.iLike]: s } },
        { phoneNumber: { [Op.iLike]: s } },
      ];
    }

    if (query.role && query.role !== "ALL") {
      const targetRole = await Role.findOne({ where: { role: { [Op.iLike]: query.role } } });
      if (targetRole) userWhere.roleId = targetRole.id;
    }

    const { count, rows: users } = await UserModal.findAndCountAll({
      where: userWhere,
      include: [
        { model: Role, as: "role", attributes: ["id", "role", "roleDescription"] },
        { model: Institute, as: "institute", attributes: ["id", "instituteId", "instituteName", "slug"] },
      ],
      order: [["updatedAt", "DESC"]],
      limit, offset,
    });

    const userIds = users.map((u) => u.userId);
    const sessions = await UserPresenceSession.findAll({ where: { userId: { [Op.in]: userIds } } });
    const sessionMap = new Map<string, any>();
    sessions.forEach((s) => sessionMap.set(s.userId, s));

    const now = Date.now();
    const formattedData = users.map((u: any) => formatUserRow(u, sessionMap, now - ONLINE_THRESHOLD_MS));

    let finalData = formattedData;
    if (query.status && query.status !== "ALL") {
      finalData = formattedData.filter((item) => item.status.toUpperCase() === query.status.toUpperCase());
    }

    return {
      error: false, statusCode: httpStatus.OK,
      message: "Platform users fetched successfully.",
      data: finalData,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  } catch (err: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: err.message };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// INSTITUTE-SCOPED (Admin / Institute pages — always scoped to an institute)
// Called from: /monitoring/overview  &  /monitoring/users
// ═══════════════════════════════════════════════════════════════════════════════

export const getInstituteOverview = async (requesterUser: any, query: any = {}, req?: any): Promise<any> => {
  try {
    const superAdminRoleIds = await getSuperAdminRoleIds();
    const adminRoleIds = await getRoleIds("ADMIN");
    const targetInstituteId = await resolveInstituteId(requesterUser, query, req);

    if (!targetInstituteId) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute context is required." };
    }

    // Exclude both super admins and regular admins from institute monitoring
    const userWhere: any = { 
      isDeleted: false, 
      roleId: { [Op.notIn]: [...superAdminRoleIds, ...adminRoleIds] }, 
      instituteId: targetInstituteId 
    };
    const presenceWhere: any = { 
      role: { [Op.notIn]: ["SUPER_ADMIN", "super_admin", "ADMIN", "admin"] }, 
      instituteId: targetInstituteId 
    };

    const now = Date.now();
    const onlineCutoff = new Date(now - ONLINE_THRESHOLD_MS);

    const totalUsers = await UserModal.count({ where: userWhere });
    const activeSessions = await UserPresenceSession.findAll({ where: presenceWhere });
    const { online } = computePresenceCounts(activeSessions, onlineCutoff);

    const teachersCount = await UserModal.count({ where: { ...userWhere, roleId: { [Op.in]: await getRoleIds("TEACHER") } } });
    const scannersCount = await UserModal.count({ where: { ...userWhere, roleId: { [Op.in]: await getRoleIds("SCANNER") } } });
    const studentsCount = await UserModal.count({ where: { ...userWhere, roleId: { [Op.in]: await getRoleIds("STUDENT") } } });

    return {
      error: false, statusCode: httpStatus.OK,
      message: "Institute overview fetched successfully.",
      data: {
        totalUsers,
        onlineUsers: online,
        offlineUsers: Math.max(0, totalUsers - online),
        activeAdmins: 0, // Admins excluded from institute monitoring
        studentsCurrentlyExams: studentsCount,
        activeTeachers: teachersCount,
        scannersProcessing: scannersCount,
      },
    };
  } catch (err: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: err.message };
  }
};

export const getInstituteUsers = async (requesterUser: any, query: any = {}, req?: any): Promise<any> => {
  try {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "25", 10)));
    const offset = (page - 1) * limit;

    const superAdminRoleIds = await getSuperAdminRoleIds();
    const adminRoleIds = await getRoleIds("ADMIN");
    const targetInstituteId = await resolveInstituteId(requesterUser, query, req);

    if (!targetInstituteId) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute context is required." };
    }

    // Exclude both super admins and regular admins from institute monitoring
    const userWhere: any = { 
      isDeleted: false, 
      roleId: { [Op.notIn]: [...superAdminRoleIds, ...adminRoleIds] }, 
      instituteId: targetInstituteId 
    };

    if (query.search) {
      const s = `%${query.search.trim()}%`;
      userWhere[Op.or] = [
        { userName: { [Op.iLike]: s } },
        { emailId: { [Op.iLike]: s } },
        { userId: { [Op.iLike]: s } },
        { phoneNumber: { [Op.iLike]: s } },
      ];
    }

    if (query.role && query.role !== "ALL") {
      const targetRole = await Role.findOne({ where: { role: { [Op.iLike]: query.role } } });
      if (targetRole) userWhere.roleId = targetRole.id;
    }

    const { count, rows: users } = await UserModal.findAndCountAll({
      where: userWhere,
      include: [
        { model: Role, as: "role", attributes: ["id", "role", "roleDescription"] },
        { model: Institute, as: "institute", attributes: ["id", "instituteId", "instituteName", "slug"] },
      ],
      order: [["updatedAt", "DESC"]],
      limit, offset,
    });

    const userIds = users.map((u) => u.userId);
    const sessions = await UserPresenceSession.findAll({ where: { userId: { [Op.in]: userIds } } });
    const sessionMap = new Map<string, any>();
    sessions.forEach((s) => sessionMap.set(s.userId, s));

    const now = Date.now();
    const formattedData = users.map((u: any) => formatUserRow(u, sessionMap, now - ONLINE_THRESHOLD_MS));

    let finalData = formattedData;
    if (query.status && query.status !== "ALL") {
      finalData = formattedData.filter((item) => item.status.toUpperCase() === query.status.toUpperCase());
    }

    return {
      error: false, statusCode: httpStatus.OK,
      message: "Institute users fetched successfully.",
      data: finalData,
      pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
    };
  } catch (err: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: err.message };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED — User Details & Activity Logs
// ═══════════════════════════════════════════════════════════════════════════════

export const getUserDetailsAndTimeline = async (
  requesterUser: any, targetUserId: string, req?: any
): Promise<any> => {
  try {
    const superAdminRoleIds = await getSuperAdminRoleIds();
    const userWhere: any = { userId: targetUserId, isDeleted: false, roleId: { [Op.notIn]: superAdminRoleIds } };

    // If institute admin, scope to their institute
    if (requesterUser?.role?.role === "ADMIN" && requesterUser?.instituteId) {
      userWhere.instituteId = requesterUser.instituteId;
    }

    const user: any = await UserModal.findOne({
      where: userWhere,
      include: [
        { model: Role, as: "role" },
        { model: Institute, as: "institute" },
      ],
    });

    if (!user) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "User not found or access denied." };
    }

    const session = await UserPresenceSession.findOne({ where: { userId: targetUserId } });
    const dbLogs = await ActivityLog.findAll({
      where: { userId: targetUserId },
      order: [["createdAt", "DESC"]],
      limit: 50,
    });

    const winstonUserLogs = await readUserWinstonLogsByUserId(targetUserId, 50);

    // Merge DB logs and Winston log entries seamlessly
    const mergedTimeline = [...dbLogs, ...winstonUserLogs].sort(
      (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const roleName = user.role?.role || "";
    let roleProgress: any = null;

    if (roleName.includes("TEACHER")) {
      const assignedExams = await Exam.count({ where: { teacherId: targetUserId, isDeleted: false } });
      const completedEvals = await AIEvaluation.count({ where: { status: "Success" } });
      const pendingEvals = await AIEvaluation.count({ where: { status: { [Op.or]: ["Pending", "Processing"] } } });
      roleProgress = {
        type: "TEACHER", assignedExams,
        evaluationsCompleted: completedEvals, evaluationsPending: pendingEvals,
        completionPercentage: completedEvals + pendingEvals > 0
          ? Math.round((completedEvals / (completedEvals + pendingEvals)) * 100) : 100,
      };
    } else if (roleName.includes("SCANNER")) {
      const uploadedSheets = await AIEvaluation.count();
      const processedSheets = await AIEvaluation.count({ where: { status: "Success" } });
      const failedSheets = await AIEvaluation.count({ where: { status: "Failed" } });
      roleProgress = {
        type: "SCANNER", totalUploaded: uploadedSheets,
        processed: processedSheets, failed: failedSheets,
        processingQueue: Math.max(0, uploadedSheets - processedSheets - failedSheets),
      };
    } else if (roleName.includes("STUDENT")) {
      roleProgress = {
        type: "STUDENT", examStatus: "N/A",
        currentExam: "N/A", questionsCompleted: 0, totalQuestions: 0, timeRemainingSeconds: 0,
      };
    }

    return {
      error: false, statusCode: httpStatus.OK,
      message: "User monitoring details fetched successfully.",
      data: {
        user: {
          id: user.id, userId: user.userId, userName: user.userName,
          emailId: user.emailId, phoneNumber: user.phoneNumber,
          role: user.role?.role, instituteName: user.institute?.instituteName || "Platform Global",
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
  } catch (err: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: err.message };
  }
};

export const getActivityLogs = async (requesterUser: any, query: any = {}, req?: any): Promise<any> => {
  try {
    const limit = parseInt(query.limit as string, 10) || 50;
    const roleFilter = query.role || "ALL";
    const statusFilter = query.status || "ALL";

    // Read live logs directly from Winston logs/combined.log file (Zero DB Load)
    const logs = await readLatestWinstonLogs(limit, roleFilter, statusFilter);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Activity logs retrieved successfully from Winston stream.",
      data: logs,
      pagination: { page: 1, limit, total: logs.length, totalPages: 1 },
    };
  } catch (err: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: err.message };
  }
};
