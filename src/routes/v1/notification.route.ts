import { Router } from "express";
import Controller from "../../controllers/notification.controller";
import { authenticate } from "../../middlewares/auth";

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

export default router;
