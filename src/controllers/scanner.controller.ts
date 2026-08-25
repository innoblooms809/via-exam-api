import { Response } from "express";
import httpStatus from "http-status";
import Scanner from "../services/scanner.service";

// POST /uploadSheets  (multipart/form-data, field name: "sheets")
const uploadSheets = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.uploadSheets(
      req.body,
      req.files as Express.Multer.File[],
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("uploadSheets Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

// GET /getAllSheets?classId=&section=&subjectId=&examType=
const getAllSheets = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.getAllSheets(req.query, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("getAllSheets Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

// GET /getFile/:sheetId  — streams the raw file
const getSheetFile = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.getSheetFile(
      req.params.sheetId,
      req.viaExamUser
    );

    if (result.error) {
      return res.status(result.statusCode).send(result);
    }

    const { buffer, mimeType, fileName } = result.data;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
    return res.send(buffer);
  } catch (err: any) {
    console.error("getSheetFile Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

// GET /summary?classId=&section=&subjectId=&examType=
const getSheetSummary = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.getSheetSummary(
      req.query as any,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("getSheetSummary Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

// PATCH /updateStatus/:sheetId
const updateSheetStatus = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.updateSheetStatus(
      req.params.sheetId,
      req.body.status,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("updateSheetStatus Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

// DELETE /deleteSheet/:sheetId
const deleteSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.deleteSheet(
      req.params.sheetId,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("deleteSheet Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

export default {
  uploadSheets,
  getAllSheets,
  getSheetFile,
  getSheetSummary,
  updateSheetStatus,
  deleteSheet,
};