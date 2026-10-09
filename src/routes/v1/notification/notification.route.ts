import { Router } from "express";
import Controller from "../../../controllers/notification/notification.controller";
import { authenticate } from "../../../middlewares/auth";

const router = Router();

router.get(
  "/getNotifications",
  authenticate,
  Controller.getNotifications,
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
