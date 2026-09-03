import crypto from "crypto";
import ActivityLog from "../modals/ActivityLog.modal";
import UserPresenceSession from "../modals/UserPresenceSession.modal";
import logger from "../config/logger";

export interface LogActivityParams {
  userId: string;
  role: string;
  instituteId?: string | null;
  eventType: string;
  entityType?: string | null;
  entityId?: string | null;
  status?: "SUCCESS" | "FAILED" | "IN_PROGRESS" | "PENDING";
  metadata?: any;
  req?: any;
  currentActivity?: string | null;
}

/**
 * Production-grade helper to record user activity events & update presence session.
 * Operates safely without crashing the main request workflow.
 */
export const logActivity = async (params: LogActivityParams): Promise<void> => {
  try {
    const {
      userId,
      role,
      instituteId = null,
      eventType,
      entityType = null,
      entityId = null,
      status = "SUCCESS",
      metadata = null,
      req,
      currentActivity,
    } = params;

    const eventId = `EVT-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const ipAddress = req
      ? (req.headers["x-forwarded-for"] as string) || req.socket?.remoteAddress || null
      : null;
    const userAgent = req ? (req.headers["user-agent"] as string) || null : null;

    // Log event using Winston Logger (Console & logs/combined.log file)
    logger.info(
      `[ACTIVITY_LOG] [${eventType}] User: ${userId} (${role}) | Institute: ${instituteId || "Global"} | Status: ${status} | IP: ${ipAddress || "Internal"}`
    );

    // Sanitize metadata to remove passwords, tokens, sensitive credentials
    let sanitizedMetadata = metadata ? { ...metadata } : {};
    if (sanitizedMetadata.password) delete sanitizedMetadata.password;
    if (sanitizedMetadata.accessToken) delete sanitizedMetadata.accessToken;
    if (sanitizedMetadata.refreshToken) delete sanitizedMetadata.refreshToken;
    if (sanitizedMetadata.token) delete sanitizedMetadata.token;

    // 1. Create Immutable Activity Log Entry
    await ActivityLog.create({
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
    let presenceStatus: "ONLINE" | "IDLE" | "OFFLINE" | "BLOCKED" = "ONLINE";
    if (eventType === "LOGOUT" || eventType === "SESSION_EXPIRED") {
      presenceStatus = "OFFLINE";
    } else if (eventType === "USER_BLOCKED") {
      presenceStatus = "BLOCKED";
    }

    const activityDesc =
      currentActivity ||
      eventType
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const existingSession = await UserPresenceSession.findOne({ where: { userId } });
    if (existingSession) {
      existingSession.role = role;
      if (instituteId) existingSession.instituteId = instituteId;
      existingSession.presenceStatus = presenceStatus;
      existingSession.lastActivityAt = now;
      existingSession.currentActivity = activityDesc;
      if (eventType === "LOGIN_SUCCESS") existingSession.lastLoginAt = now;
      if (eventType === "LOGOUT") existingSession.lastLogoutAt = now;
      if (ipAddress) existingSession.ipAddress = ipAddress;
      if (userAgent) existingSession.deviceInfo = userAgent.slice(0, 200);
      await existingSession.save();
    } else {
      await UserPresenceSession.create({
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
  } catch (err: any) {
    console.error("Failed to log activity event:", err.message);
  }
};
