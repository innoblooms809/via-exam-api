import { Response } from "express";
import httpStatus from "http-status";
import NotificationService from "../../services/notification/notification.service";
import PushService from "../../services/notification/push.service";

const getNotifications = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await NotificationService.getNotifications(req.viaExamUser, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const listNotifications = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await NotificationService.listNotifications(req.viaExamUser, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const markAllAsRead = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await NotificationService.markAllAsRead(req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const markAsRead = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await NotificationService.markAsRead(req.params.notificationId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const registerPushToken = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await PushService.registerToken(req.body, req.viaExamUser, req.headers["user-agent"]);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

const removePushToken = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await PushService.removeToken(req.params.token, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

export default {
  getNotifications,
  listNotifications,
  markAsRead,
  markAllAsRead,
  registerPushToken,
  removePushToken,
};
