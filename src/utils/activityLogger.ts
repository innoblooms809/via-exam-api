import crypto from "crypto";
import ActivityLog from "../models/ActivityLog.model";
import UserPresenceSession from "../models/UserPresenceSession.model";
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

const SECRET_KEY = /pass(word)?|token|secret|otp|authorization|cookie|api[-_]?key/i;
const MAX_METADATA_CHARS = 8 * 1024;

/** Copy of a value with every secret-looking key removed, at any depth. */
const redactSecrets = (value: unknown, depth = 0): unknown => {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redactSecrets(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (!SECRET_KEY.test(key)) out[key] = redactSecrets(v, depth + 1);
  }
  return out;
};

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
    // X-Forwarded-For is "client, proxy1, proxy2": keep the client, and fit the
    // 64-char column (an over-long value used to make the insert fail silently).
    const forwarded = req ? String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() : "";
    const ipAddress = req ? (forwarded || req.socket?.remoteAddress || "").slice(0, 64) || null : null;
    const userAgent = req ? String(req.headers["user-agent"] ?? "").slice(0, 500) || null : null;

    // Log event using Winston Logger (Console & logs/combined.log file)
    logger.info(
      `[ACTIVITY_LOG] [${eventType}] User: ${userId} (${role}) | Institute: ${instituteId || "Global"} | Status: ${status} | IP: ${ipAddress || "Internal"}`
    );

    // Secrets are removed at any depth, and the stored payload is capped so one
    // noisy event can't bloat the table.
    const sanitizedMetadata = redactSecrets(metadata ?? {}) as Record<string, any>;
    if (JSON.stringify(sanitizedMetadata).length > MAX_METADATA_CHARS) {
      for (const key of Object.keys(sanitizedMetadata)) delete sanitizedMetadata[key];
      sanitizedMetadata.truncated = true;
    }

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
