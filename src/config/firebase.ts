import fs from "fs";
import path from "path";
import { cert, getApps, initializeApp, ServiceAccount } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";
import config from "./config";
import logger from "./logger";

// Firebase Admin is only used for push notifications (FCM). Without a service
// account the API still runs; pushes are skipped and in-app notifications work as before.

let messaging: Messaging | null = null;
let initialised = false;

const loadServiceAccount = (): ServiceAccount | null => {
  const { serviceAccountJson, serviceAccountPath } = config.firebase;

  if (serviceAccountJson) {
    const raw = serviceAccountJson.trim();
    const json = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(json);
  }

  const filePath = serviceAccountPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (filePath) {
    const resolved = path.resolve(process.cwd(), filePath);
    return JSON.parse(fs.readFileSync(resolved, "utf8"));
  }

  return null;
};

/** FCM client, or null when Firebase is not configured. */
export const getFirebaseMessaging = (): Messaging | null => {
  if (initialised) return messaging;
  initialised = true;

  try {
    const serviceAccount = loadServiceAccount();
    if (!serviceAccount) {
      logger.warn("Firebase not configured (FIREBASE_SERVICE_ACCOUNT_PATH / FIREBASE_SERVICE_ACCOUNT_JSON) — push notifications disabled.");
      return null;
    }

    const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
    messaging = getMessaging(app);
    logger.info("Firebase Admin initialised — push notifications enabled.");
  } catch (err: any) {
    logger.error(`Firebase Admin failed to initialise — push notifications disabled: ${err?.message || err}`);
    messaging = null;
  }

  return messaging;
};
