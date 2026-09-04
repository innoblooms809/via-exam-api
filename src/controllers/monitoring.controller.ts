import { Response } from "express";
import httpStatus from "http-status";
import * as monitoringService from "../services/monitoring.service";

export const recordHeartbeat = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await monitoringService.recordHeartbeat(
      req.viaExamUser,
      req.body?.currentActivity
    );
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};

export const cleanupStaleSessions = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await monitoringService.cleanupStaleSessions();
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};

// ── Platform-Wide (Super Admin Global — no institute filter) ──────────────────

export const getPlatformOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await monitoringService.getPlatformOverview(req.query);
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};

export const getPlatformUsers = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await monitoringService.getPlatformUsers(req.query);
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};

// ── Institute-Scoped (Admin — scoped to user's institute) ────────────────────

export const getMonitoringOverview = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await monitoringService.getInstituteOverview(req.viaExamUser, req.query, req);
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};

export const getMonitoredUsers = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await monitoringService.getInstituteUsers(req.viaExamUser, req.query, req);
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};

export const getUserDetailsAndTimeline = async (
  req: any,
  res: Response
): Promise<any> => {
  try {
    const { userId } = req.params;
    const result = await monitoringService.getUserDetailsAndTimeline(
      req.viaExamUser,
      userId,
      req
    );
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};

export const getActivityLogs = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await monitoringService.getActivityLogs(
      req.viaExamUser,
      req.query,
      req
    );
    return res.status(result.statusCode).json(result);
  } catch (err: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err.message,
    });
  }
};
