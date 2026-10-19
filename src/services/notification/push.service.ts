import httpStatus from "http-status";
import PushToken from "../../models/PushToken.model";
import { getFirebaseMessaging } from "../../config/firebase";
import logger from "../../config/logger";

// FCM answers with these when a token will never work again — drop it.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);

const MAX_TOKEN_LENGTH = 4096;

// ─── REGISTER THIS BROWSER FOR THE LOGGED-IN USER ─────────────────────────────
const registerToken = async (body: any, requestedBy: any, userAgent?: string): Promise<any> => {
  try {
    const token = typeof body?.token === "string" ? body.token.trim() : "";
    if (!token || token.length > MAX_TOKEN_LENGTH) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "A valid push token is required." };
    }

    const appUrl = typeof body?.appUrl === "string" && /^https?:\/\//i.test(body.appUrl)
      ? body.appUrl.slice(0, 2048)
      : null;

    const values = {
      token,
      userId: requestedBy.userId,
      instituteId: requestedBy.instituteId || null,
      role: requestedBy.role?.role || null,
      appUrl,
      userAgent: userAgent ? userAgent.slice(0, 1024) : null,
      lastSeenAt: new Date(),
    };

    // One row per browser and user: several users logged in on one browser each keep their pushes.
    // Logging out removes only that user's row. An atomic upsert: the UI registers on mount and
    // again on click (React StrictMode runs effects twice), and a find-then-create race hits the unique index.
    await PushToken.upsert(values, { conflictFields: ["token", "userId"] });

    return { error: false, statusCode: httpStatus.OK, message: "Push notifications enabled." };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

// ─── UNREGISTER (LOGOUT / PERMISSION REVOKED) ─────────────────────────────────
const removeToken = async (token: string, requestedBy: any): Promise<any> => {
  try {
    await PushToken.destroy({ where: { token, userId: requestedBy.userId } });
    return { error: false, statusCode: httpStatus.OK, message: "Push notifications disabled." };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

type PushNotification = {
  notificationId: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
};

// ─── SEND TO EVERY BROWSER OF A USER ──────────────────────────────────────────
// Never throws: a failed push must not break the action that created the notification.
const sendToUser = async (notification: PushNotification): Promise<void> => {
  try {
    const messaging = getFirebaseMessaging();
    if (!messaging) return;

    const tokens = await PushToken.findAll({ where: { userId: notification.userId } });
    if (tokens.length === 0) return;

    // Data-only message: the service worker / open tab decides how to show it.
    const messages = tokens.map((t) => ({
      token: t.token,
      data: {
        notificationId: notification.notificationId,
        // Lets an open tab ignore pushes meant for another user logged in on the same browser.
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        body: notification.message,
        referenceId: notification.referenceId || "",
        link: t.appUrl || "",
      },
      webpush: { headers: { Urgency: "high", TTL: String(60 * 60 * 24) } },
    }));

    const response = await messaging.sendEach(messages);

    const dead = response.responses
      .map((r, i) => (!r.success && DEAD_TOKEN_CODES.has(r.error?.code || "") ? tokens[i].token : null))
      .filter((t): t is string => !!t);

    if (dead.length) {
      await PushToken.destroy({ where: { token: dead } });
    }
    if (response.failureCount > dead.length) {
      const other = response.responses.find((r) => !r.success && !DEAD_TOKEN_CODES.has(r.error?.code || ""));
      logger.warn(`Push to user ${notification.userId}: ${response.failureCount} failed (${other?.error?.code || "unknown"}).`);
    }
  } catch (err: any) {
    logger.error(`Push to user ${notification.userId} failed: ${err?.message || err}`);
  }
};

export default {
  registerToken,
  removeToken,
  sendToUser,
};
