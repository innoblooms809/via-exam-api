import httpStatus from "http-status";
import Scanner from "../modals/Scanner.modal";
import RegHelper from "../utils/helper";

// ─── UPLOAD (single or bulk) ──────────────────────────────────────────────────

const uploadSheets = async (
  body: {
    classId: string;
    section: string;
    subjectId: string;
    examType: string;
  },
  files: Express.Multer.File[],
  uploadedBy: any
): Promise<any> => {
  try {
    const instituteId = uploadedBy.instituteId;
    if (!instituteId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute not found for this user.",
      };
    }

    if (!files || files.length === 0) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "No files provided.",
      };
    }

    const results: { rollNo: string; status: string; reason?: string }[] = [];

    for (const file of files) {
      // Roll number = filename without extension (matches your frontend logic)
      const rollNo = file.originalname.replace(/\.[^.]+$/, "");

      if (!/^\d+$/.test(rollNo)) {
        results.push({ rollNo: file.originalname, status: "skipped", reason: "Filename is not a valid roll number" });
        continue;
      }

      // Check duplicate
      const existing = await Scanner.findOne({
        where: {
          instituteId,
          classId: body.classId,
          section: body.section,
          subjectId: body.subjectId,
          examType: body.examType,
          rollNo,
          isDeleted: false,
        },
      });

      if (existing) {
        results.push({ rollNo, status: "duplicate", reason: "Sheet already uploaded for this student" });
        continue;
      }

      const sheetId = await RegHelper.generateUserId();

      await Scanner.create({
        sheetId,
        instituteId,
        classId: body.classId,
        section: body.section,
        subjectId: body.subjectId,
        examType: body.examType,
        rollNo,
        fileName: file.originalname,
        fileBuffer: file.buffer,
        fileMimeType: file.mimetype,
        fileSize: file.size,
        uploadedBy: uploadedBy.userId,
        status: "Pending",
      });

      results.push({ rollNo, status: "saved" });
    }

    const saved = results.filter((r) => r.status === "saved").length;
    const failed = results.length - saved;

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: `${saved} sheet(s) saved. ${failed} skipped/duplicate.`,
      data: { results },
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ALL SHEETS (with filters) ───────────────────────────────────────────

const getAllSheets = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const { classId, section, subjectId, examType, rollNo, status } = query;

    const where: any = { instituteId, isDeleted: false };
    if (classId) where.classId = classId;
    if (section) where.section = section;
    if (subjectId) where.subjectId = subjectId;
    if (examType) where.examType = examType;
    if (rollNo) where.rollNo = rollNo;
    if (status) where.status = status;

    // Never return fileBuffer in list — too heavy
    const sheets = await Scanner.findAll({
      where,
      attributes: { exclude: ["fileBuffer"] },
      order: [["createdAt", "DESC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sheets fetched successfully.",
      data: { sheets, total: sheets.length },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET SHEET FILE (stream back to client) ───────────────────────────────────

const getSheetFile = async (sheetId: string, requestedBy: any): Promise<any> => {
  try {
    const sheet = await Scanner.findOne({
      where: { sheetId, isDeleted: false },
    });

    if (!sheet) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Sheet not found.",
      };
    }

    if (sheet.instituteId !== requestedBy.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "File fetched.",
      data: {
        buffer: sheet.fileBuffer,
        mimeType: sheet.fileMimeType,
        fileName: sheet.fileName,
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

// ─── GET SUMMARY (uploaded vs missing counts) ─────────────────────────────────

const getSheetSummary = async (
  query: { classId: string; section: string; subjectId: string; examType: string },
  requestedBy: any
): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const { classId, section, subjectId, examType } = query;

    if (!classId || !section || !subjectId || !examType) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "classId, section, subjectId and examType are required.",
      };
    }

    const sheets = await Scanner.findAll({
      where: { instituteId, classId, section, subjectId, examType, isDeleted: false },
      attributes: ["rollNo", "status", "fileName", "createdAt"],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Summary fetched.",
      data: {
        total: sheets.length,
        pending: sheets.filter((s) => s.status === "Pending").length,
        evaluated: sheets.filter((s) => s.status === "Evaluated").length,
        uploadedRollNos: sheets.map((s) => s.rollNo),
        sheets,
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

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────

const updateSheetStatus = async (
  sheetId: string,
  status: string,
  requestedBy: any
): Promise<any> => {
  try {
    const allowed = ["Pending", "Evaluated"];
    if (!allowed.includes(status)) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Status must be one of: ${allowed.join(", ")}`,
      };
    }

    const sheet = await Scanner.findOne({ where: { sheetId, isDeleted: false } });
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Sheet not found." };
    }

    if (sheet.instituteId !== requestedBy.instituteId) {
      return { error: true, statusCode: httpStatus.FORBIDDEN, message: "Access denied." };
    }

    await sheet.update({ status });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Sheet status updated to ${status}.`,
      data: sheet,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── SOFT DELETE ──────────────────────────────────────────────────────────────

const deleteSheet = async (sheetId: string, requestedBy: any): Promise<any> => {
  try {
    const sheet = await Scanner.findOne({ where: { sheetId, isDeleted: false } });
    if (!sheet) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Sheet not found." };
    }

    if (sheet.instituteId !== requestedBy.instituteId) {
      return { error: true, statusCode: httpStatus.FORBIDDEN, message: "Access denied." };
    }

    await sheet.update({ isDeleted: true });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sheet deleted successfully.",
      data: {},
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
  uploadSheets,
  getAllSheets,
  getSheetFile,
  getSheetSummary,
  updateSheetStatus,
  deleteSheet,
};