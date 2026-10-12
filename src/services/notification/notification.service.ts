import httpStatus from "http-status";
import { Op, WhereOptions } from "sequelize";
import Notification from "../../models/Notification.model";
import Institute from "../../models/Institute.model";

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// Super admins belong to no institute; their notifications are filed under the institute they're about.
const ownerWhere = (requestedBy: any): Record<string, unknown> => ({
  userId: requestedBy.userId,
  ...(requestedBy.instituteId ? { instituteId: requestedBy.instituteId } : {}),
  isDeleted: false,
});

const format = (notif: Notification) => ({
  id: notif.notificationId,
  type: notif.type,
  title: notif.title,
  message: notif.message,
  referenceId: notif.referenceId,
  isRead: notif.isRead,
  createdAt: notif.createdAt,
});

// ─── GET NOTIFICATIONS (FOR LOGGED IN USER) ─────────────────────────────────────────
// Query: limit (1–100, default 30) · before (ISO date cursor, for "load more") · unread=true
const getNotifications = async (requestedBy: any, query: any = {}): Promise<any> => {
  try {
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(query.limit) || DEFAULT_LIMIT));
    const owner = ownerWhere(requestedBy);
    const where: WhereOptions = { ...owner };
    if (query.unread === "true") Object.assign(where, { isRead: false });
    const before = query.before ? new Date(String(query.before)) : null;
    if (before && !Number.isNaN(before.getTime())) Object.assign(where, { createdAt: { [Op.lt]: before } });

    const [rows, unreadCount] = await Promise.all([
      Notification.findAll({
        where,
        attributes: ["notificationId", "type", "title", "message", "referenceId", "isRead", "createdAt"],
        order: [["createdAt", "DESC"]],
        limit: limit + 1, // one extra row tells us whether there is a next page
      }),
      Notification.count({ where: { ...owner, isRead: false } }),
    ]);

    const hasMore = rows.length > limit;
    const notifications = (hasMore ? rows.slice(0, limit) : rows).map(format);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Notifications fetched successfully.",
      data: {
        notifications,
        unreadCount,
        hasMore,
        nextCursor: hasMore ? notifications[notifications.length - 1].createdAt : null,
      },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── LIST NOTIFICATIONS (PAGE NUMBERS, FOR THE FULL NOTIFICATIONS PAGE) ─────────────
// Query: page · limit (1–100, default 20) · unread=true · types=A,B (notification types)
// Returns { notifications (with instituteName), unreadCount, pagination }
const TYPE_RE = /^[A-Z0-9_]{1,64}$/;

const listNotifications = async (requestedBy: any, query: any = {}): Promise<any> => {
  try {
    const page = Math.max(1, Math.floor(Number(query.page)) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(Number(query.limit)) || 20));
    const owner = ownerWhere(requestedBy);
    const where: WhereOptions = { ...owner };
    if (query.unread === "true") Object.assign(where, { isRead: false });
    const types = String(query.types || "")
      .split(",")
      .map((t) => t.trim())
      .filter((t) => TYPE_RE.test(t))
      .slice(0, 20);
    if (types.length) Object.assign(where, { type: { [Op.in]: types } });

    const [{ rows, count }, unreadCount] = await Promise.all([
      Notification.findAndCountAll({
        where,
        attributes: ["notificationId", "instituteId", "type", "title", "message", "referenceId", "isRead", "createdAt"],
        order: [["createdAt", "DESC"]],
        limit,
        offset: (page - 1) * limit,
      }),
      Notification.count({ where: { ...owner, isRead: false } }),
    ]);

    // Name the institute each notification is about (super admins see every institute).
    const instituteIds = [...new Set(rows.map((n) => n.instituteId).filter(Boolean))];
    const institutes = instituteIds.length
      ? await Institute.findAll({
          where: { instituteId: { [Op.in]: instituteIds } },
          attributes: ["id", "instituteId", "instituteName", "slug"],
        })
      : [];
    const byId = new Map(institutes.map((i) => [i.instituteId, i]));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Notifications fetched successfully.",
      data: {
        notifications: rows.map((n) => {
          const inst = byId.get(n.instituteId);
          return {
            ...format(n),
            instituteId: n.instituteId || null,
            instituteName: inst?.instituteName || null,
            instituteRowId: inst?.id ?? null,
          };
        }),
        unreadCount,
        pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
      },
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

// ─── MARK ALL AS READ ─────────────────────────────────────────
const markAllAsRead = async (requestedBy: any): Promise<any> => {
  try {
    const [updated] = await Notification.update(
      { isRead: true },
      { where: { ...ownerWhere(requestedBy), isRead: false } }
    );
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "All notifications marked as read.",
      data: { updated },
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
  listNotifications,
  markAsRead,
  markAllAsRead,
};
