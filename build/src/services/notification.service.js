"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_status_1 = __importDefault(require("http-status"));
const Notification_modal_1 = __importDefault(require("../modals/Notification.modal"));
// ─── GET NOTIFICATIONS (FOR LOGGED IN USER) ─────────────────────────────────────────
const getNotifications = (requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = requestedBy.userId;
        const instituteId = requestedBy.instituteId;
        const notifications = yield Notification_modal_1.default.findAll({
            where: {
                userId,
                instituteId,
                isDeleted: false
            },
            order: [["createdAt", "DESC"]],
        });
        const formattedNotifications = notifications.map((notif) => ({
            id: notif.notificationId,
            type: notif.type,
            title: notif.title,
            message: notif.message,
            referenceId: notif.referenceId,
            isRead: notif.isRead,
        }));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Notifications fetched successfully.",
            data: { notifications: formattedNotifications },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── MARK NOTIFICATION AS READ ─────────────────────────────────────────
const markAsRead = (notificationId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const userId = requestedBy.userId;
        const notification = yield Notification_modal_1.default.findOne({
            where: { notificationId, userId, isDeleted: false }
        });
        if (!notification) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Notification not found.",
            };
        }
        yield notification.update({ isRead: true });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Notification marked as read.",
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
exports.default = {
    getNotifications,
    markAsRead,
};
