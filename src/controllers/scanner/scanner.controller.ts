import { Response } from "express";
import httpStatus from "http-status";
import Scanner from "../../services/scanner/scanner.service";
import { contentDisposition } from "../../utils/fileNames";

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
      // The cause is logged above; its text is no help to the user and may expose internals.
      message: "Something went wrong. Please try again.",
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
      // The cause is logged above; its text is no help to the user and may expose internals.
      message: "Something went wrong. Please try again.",
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
      // The cause is logged above; its text is no help to the user and may expose internals.
      message: "Something went wrong. Please try again.",
    });
  }
};

// GET /getFile/:sheetId  — streams the raw file
const getSheetFile = async (req: any, res: Response): Promise<any> => {
  try {
    // ?mode=url only asks where the file is: no need to read a legacy sheet's bytes for that.
    const result = await Scanner.getSheetFile(req.params.sheetId, req.viaExamUser, { buffer: String(req.query.mode) !== "url" });

    if (result.error) {
      return res.status(result.statusCode).send(result);
    }

    const { buffer, mimeType, fileName, remoteUrl, filePath } = result.data;

    // Every sheet is streamed from here, after the access checks above; none has a link to
    // hand out. A caller asking for one (?mode=url) is told so and downloads the bytes.
    if (String(req.query.mode) === "url") {
      return res.status(httpStatus.OK).send({
        error: false,
        statusCode: httpStatus.OK,
        message: "File located.",
        data: { url: null, mimeType, fileName },
      });
    }

    res.setHeader("Cache-Control", "private, no-store");

    if (filePath) {
      // Stored on this server.
      // A stored name may be Arabic: plain headers carry latin1 only (Node throws on more).
      res.setHeader("Content-Disposition", contentDisposition("inline", fileName));
      return res.sendFile(filePath, { headers: { "Content-Type": mimeType || "application/octet-stream" } }, (err: any) => {
        if (!err || res.headersSent) return;
        const missing = err?.statusCode === 404 || err?.code === "ENOENT";
        const status = missing ? httpStatus.NOT_FOUND : httpStatus.INTERNAL_SERVER_ERROR;
        res.status(status).json({
          error: true,
          statusCode: status,
          message: missing
            ? "The stored file could not be found. Please upload the sheet again."
            : "Something went wrong. Please try again.",
        });
      });
    }

    if (remoteUrl) {
      // Stored in Cloudinary before the move to local storage: fetched here and streamed
      // on, so its permanent public link never reaches the browser.
      const upstream = await fetch(remoteUrl);
      if (!upstream.ok || !upstream.body) {
        return res.status(httpStatus.BAD_GATEWAY).json({
          error: true,
          statusCode: httpStatus.BAD_GATEWAY,
          message: "The stored file could not be retrieved. Please try again.",
        });
      }

      res.setHeader("Content-Type", upstream.headers.get("content-type") || mimeType);
      // A stored name may be Arabic: plain headers carry latin1 only (Node throws on more).
      res.setHeader("Content-Disposition", contentDisposition("inline", fileName));
      const length = upstream.headers.get("content-length");
      if (length) res.setHeader("Content-Length", length);

      // Streamed rather than buffered so a 20 MB scan never sits on the heap.
      const { Readable } = await import("stream");
      return Readable.fromWeb(upstream.body as any).pipe(res);
    }

    // Legacy sheet still held as a database blob.
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", contentDisposition("inline", fileName));
    return res.send(buffer);
  } catch (err: any) {
    console.error("getSheetFile Controller Error:", err);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      // The cause is logged above; its text is no help to the user and may expose internals.
      message: "Something went wrong. Please try again.",
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
      // The cause is logged above; its text is no help to the user and may expose internals.
      message: "Something went wrong. Please try again.",
    });
  }
};

export default {
  uploadSheets,
  replaceSheet,
  getAllSheets,
  getSheetFile,
  deleteSheet,
};
