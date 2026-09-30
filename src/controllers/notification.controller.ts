import { Response } from "express";
import httpStatus from "http-status";
import NotificationService from "../services/notification.service";

const getNotifications = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await NotificationService.getNotifications(req.viaExamUser);
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

export default {
  getNotifications,
  markAsRead,
};
