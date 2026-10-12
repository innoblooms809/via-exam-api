import { Router } from "express";
import Controller from "../../../controllers/notification/notification.controller";
import { authenticate } from "../../../middlewares/auth";

const router = Router();

// ?limit=30 (max 100) · ?before=<ISO date> for the next page · ?unread=true
// Returns { notifications, unreadCount, hasMore, nextCursor }
router.get(
  "/getNotifications",
  authenticate,
  Controller.getNotifications,
);

// ?page=1&limit=20 (max 100) · ?unread=true · ?types=SUBSCRIPTION_EXPIRING,SUBSCRIPTION_EXPIRED
// Returns { notifications (with instituteName), unreadCount, pagination } — for the full notifications page
router.get(
  "/list",
  authenticate,
  Controller.listNotifications,
);

router.patch(
  "/read-all",
  authenticate,
  Controller.markAllAsRead,
);

router.patch(
  "/notification/:notificationId/read",
  authenticate,
  Controller.markAsRead,
);

// Firebase Cloud Messaging: register / unregister this browser for push notifications
router.post(
  "/push-token",
  authenticate,
  Controller.registerPushToken,
);

router.delete(
  "/push-token/:token",
  authenticate,
  Controller.removePushToken,
);

export default router;
