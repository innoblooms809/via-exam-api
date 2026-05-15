import httpStatus from "http-status";
import { Response } from "express";
import SessionService from "../services/session.service";

// ─── CREATE ───────────────────────────────────────────────────────────────────
const createSession = async (req: any, res: Response): Promise<any> => {
  try {
    console.log("REQ USER:", req.viaExamUser);
    const result = await SessionService.createSession(
      req.body,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── GET ALL ──────────────────────────────────────────────────────────────────
const getAllSessions = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await SessionService.getAllSessions(
      req.viaExamUser,
      req.query
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── GET ONE ──────────────────────────────────────────────────────────────────
const getSessionById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await SessionService.getSessionById(
      req.params.sessionId,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── GET ACTIVE ───────────────────────────────────────────────────────────────
const getActiveSession = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await SessionService.getActiveSession(req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── ACTIVATE ─────────────────────────────────────────────────────────────────
const activateSession = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await SessionService.activateSession(
      req.params.sessionId,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── UPDATE ───────────────────────────────────────────────────────────────────
const updateSession = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await SessionService.updateSession(
      req.params.sessionId,
      req.body,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────
const deleteSession = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await SessionService.deleteSession(
      req.params.sessionId,
      req.viaExamUser
    );
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
  createSession,
  getAllSessions,
  getSessionById,
  getActiveSession,
  activateSession,
  updateSession,
  deleteSession,
};