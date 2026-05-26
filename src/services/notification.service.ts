import httpStatus from "http-status";
import Notification from "../modals/Notification.modal";
import RegHelper from "../utils/helper";

// ─── GET NOTIFICATIONS (FOR LOGGED IN USER) ─────────────────────────────────────────
const getNotifications = async (requestedBy: any): Promise<any> => {
  try {
    const userId = requestedBy.userId;
    const instituteId = requestedBy.instituteId;

    const notifications = await Notification.findAll({
      where: { 
        userId,
        instituteId,
        isDeleted: false 
      },
      order: [["createdAt", "DESC"]],
    });

    const formattedNotifications = notifications.map((notif: any) => ({
      id: notif.notificationId,
      type: notif.type,
      title: notif.title,
      message: notif.message,
      referenceId: notif.referenceId,
      isRead: notif.isRead,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Notifications fetched successfully.",
      data: { notifications: formattedNotifications },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── MARK NOTIFICATION AS READ ─────────────────────────────────────────
const markAsRead = async (notificationId: string, requestedBy: any): Promise<any> => {
  try {
    const userId = requestedBy.userId;
    const notification = await Notification.findOne({
      where: { notificationId, userId, isDeleted: false }
    });

    if (!notification) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Notification not found.",
      };
    }

    await notification.update({ isRead: true });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Notification marked as read.",
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  getNotifications,
  markAsRead,
};
