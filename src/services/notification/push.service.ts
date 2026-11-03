import httpStatus from "http-status";
import PushToken from "../../models/PushToken.model";
import { getFirebaseMessaging } from "../../config/firebase";
import logger from "../../config/logger";
import { defineQueue } from "../../queue";
import { positiveInt } from "../../queue/config";

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
// Throws when FCM could not be reached at all (the push queue then retries the job). A token
// FCM refused for good is dropped; other per-browser failures are only logged, because
// retrying the whole job would push again to the browsers that did get it.
const deliver = async (notification: PushNotification): Promise<{ sent: number; failed: number }> => {
  const messaging = getFirebaseMessaging();
  if (!messaging) return { sent: 0, failed: 0 };

  const tokens = await PushToken.findAll({ where: { userId: notification.userId } });
  if (tokens.length === 0) return { sent: 0, failed: 0 };

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
  return { sent: response.successCount, failed: response.failureCount };
};

// Never throws: a failed push must not break the action that created the notification.
const sendToUser = async (notification: PushNotification): Promise<void> => {
  try {
    await deliver(notification);
  } catch (err: any) {
    logger.error(`Push to user ${notification.userId} failed: ${err?.message || err}`);
  }
};

// ─── PUSH QUEUE ───────────────────────────────────────────────────────────────
// Every notification's push is a job: the request that created the notification never waits
// for FCM, a burst (an exam's 500 students) is sent a few at a time, and an FCM outage is
// retried with backoff instead of losing the pushes.

const pushQueue = defineQueue<PushNotification>({
  name: "notifications-push",
  concurrency: positiveInt(process.env.PUSH_QUEUE_CONCURRENCY, 5),
  defaults: { attempts: 5, backoff: { type: "exponential", delayMs: 15_000 }, keepCompletedSec: 24 * 3600, keepFailedSec: 7 * 24 * 3600 },
  processor: async (job) => deliver(job.data),
});

let pending: PushNotification[] = [];

const flush = () => {
  const batch = pending;
  pending = [];
  pushQueue
    .addBulk(batch.map((n) => ({ name: "push", data: n, opts: { jobId: `push-${n.notificationId}` } })))
    .catch((err) => {
      logger.warn(`Push queue unavailable (${err?.message || err}); sending ${batch.length} push(es) directly.`);
      batch.forEach((n) => void sendToUser(n));
    });
};

/** Queues the push of a notification. Notifications created together are queued in one batch. */
const enqueuePush = (notification: PushNotification): void => {
  if (!getFirebaseMessaging()) return; // pushes are not configured
  pending.push({
    notificationId: notification.notificationId,
    userId: notification.userId,
    type: notification.type,
    title: notification.title,
    message: notification.message,
    referenceId: notification.referenceId ?? null,
  });
  if (pending.length === 1) setImmediate(flush);
};

export default {
  registerToken,
  removeToken,
  sendToUser,
  enqueuePush,
};
