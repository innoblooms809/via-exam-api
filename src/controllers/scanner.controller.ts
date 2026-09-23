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

// PUT /replaceSheet/:sheetId  (multipart/form-data, field name: "sheet")
const replaceSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.replaceSheet(
      req.params.sheetId,
      req.file as Express.Multer.File | undefined,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("replaceSheet Controller Error:", err);
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

    const { buffer, mimeType, fileName, redirectUrl } = result.data;

    if (redirectUrl) {
      // Preferred path: the caller takes the short-lived signed URL and loads
      // the file straight from the CDN, so the bytes never touch this process.
      if (String(req.query.mode) === "url") {
        return res.status(httpStatus.OK).send({
          error: false,
          statusCode: httpStatus.OK,
          message: "File located.",
          data: { url: redirectUrl, mimeType, fileName },
        });
      }

      // Compatibility path: callers that expect raw bytes get them streamed
      // through. A 302 is not usable here — the browser would repeat the
      // request to Cloudinary in credentialed CORS mode and be blocked.
      const upstream = await fetch(redirectUrl);
      if (!upstream.ok || !upstream.body) {
        return res.status(httpStatus.BAD_GATEWAY).json({
          error: true,
          statusCode: httpStatus.BAD_GATEWAY,
          message: "The stored file could not be retrieved. Please try again.",
        });
      }

      res.setHeader("Content-Type", upstream.headers.get("content-type") || mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
      const length = upstream.headers.get("content-length");
      if (length) res.setHeader("Content-Length", length);

      // Streamed rather than buffered so a 20 MB scan never sits on the heap.
      const { Readable } = await import("stream");
      return Readable.fromWeb(upstream.body as any).pipe(res);
    }

    // Legacy sheet still held as a database blob.
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

// ─── APPROVAL WORKFLOW SCANNER ENDPOINTS ────────────────────────────────

// GET /approved-exams
const getApprovedExams = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.getApprovedExams(req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("getApprovedExams Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

// POST /upload-student-answer
const uploadStudentAnswerPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.uploadStudentAnswerPaper(
      req.body,
      req.file,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("uploadStudentAnswerPaper Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

// GET /student-answers/:examId
const getStudentAnswerPapers = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await Scanner.getStudentAnswerPapers(
      req.params.examId,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (err: any) {
    console.error("getStudentAnswerPapers Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: err?.message || "Internal Server Error",
    });
  }
};

export default {
  uploadSheets,
  replaceSheet,
  getAllSheets,
  getSheetFile,
  getSheetSummary,
  updateSheetStatus,
  deleteSheet,
  getApprovedExams,
  uploadStudentAnswerPaper,
  getStudentAnswerPapers,
};