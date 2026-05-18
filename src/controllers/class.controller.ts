import httpStatus from "http-status";
import { Request,Response } from "express";
import ClassService from "../services/class.service";

// ─── CREATE CLASS ─────────────────────────────────────────────────────────────
const createClass = async (
  req: any,
  res: Response
): Promise<any> => {
  try {

    const result = await ClassService.createClass(
      req.body,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error: any) {

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });

  }
};

// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = async (
  req: any,
  res: Response
): Promise<any> => {
  try {

    const result = await ClassService.getAllClasses(
          req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error: any) {

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });

  }
};

// ─── GET CLASS BY ID ──────────────────────────────────────────────────────────
const getClassById = async (
  req: any,
  res: Response
): Promise<any> => {
  try {

    const result = await ClassService.getClassById(
      req.params.classId,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error: any) {

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });

  }
};

// ─── UPDATE CLASS ─────────────────────────────────────────────────────────────
const updateClass = async (
  req: any,
  res: Response
): Promise<any> => {
  try {

    const result = await ClassService.updateClass(
      req.params.classId,
      req.body,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error: any) {

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });

  }
};

// ─── DELETE CLASS ─────────────────────────────────────────────────────────────
const deleteClass = async (
  req: any,
  res: Response
): Promise<any> => {
  try {

    const result = await ClassService.deleteClass(
      req.params.classId,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error: any) {

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });

  }
};

export default {
  createClass,
  getAllClasses,
  getClassById,
  updateClass,
  deleteClass,
};