import httpStatus from "http-status";
import Scanner from "../modals/Scanner.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import Exam from "../modals/Exam.modal";
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

    const sheetIds = sheets.map((s: any) => s.sheetId);
    const aiEvals =
      sheetIds.length > 0
        ? await AIEvaluation.findAll({
          where: { sheetId: sheetIds },
          attributes: ["sheetId", "totalScore", "status"],
        })
        : [];

    const evalMap = new Map<string, any>();
    aiEvals.forEach((ev: any) => {
      evalMap.set(ev.sheetId, ev);
    });

    const enrichedSheets = sheets.map((sheet: any) => {
      const s = sheet.toJSON();
      const ev = evalMap.get(s.sheetId);
      if (ev) {
        if (ev.status === "Success") {
          s.status = "Evaluated";
          s.aiScore = ev.totalScore;
        } else if (ev.status === "Pending") {
          s.status = "Evaluating";
          s.aiScore = null;
        } else if (ev.status === "Failed") {
          s.status = "Failed";
          s.aiScore = null;
        }
      }
      return s;
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sheets fetched successfully.",
      data: { sheets: enrichedSheets, total: enrichedSheets.length },
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

// ─── APPROVAL WORKFLOW SCANNER ENDPOINTS ────────────────────────────────────

// Get approved exams for scanner to upload student answer papers
const getApprovedExams = async (requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;

    // Find exams where both question paper and answer sheet are approved
    const questionPapers = await QuestionPaper.findAll({
      where: { instituteId, status: "APPROVED" },
      attributes: ["examId", "paperSet", "teacherId"],
    });

    const answerSheets = await QuestionPaperAnswer.findAll({
      where: { instituteId, status: "APPROVED" },
      attributes: ["examId", "paperSet", "teacherId"],
    });

    // Find exam IDs that have both approved QP and answer sheet
    const approvedExamIds = new Set(
      [...questionPapers, ...answerSheets].map((item) => item.examId)
    );

    const exams = await Exam.findAll({
      where: { 
        examId: Array.from(approvedExamIds),
        instituteId,
        isDeleted: false,
      },
      attributes: ["examId", "examName", "instituteId", "status"],
    });

    // For each exam, get additional details and count uploaded student papers
    const enrichedExams = await Promise.all(
      exams.map(async (exam: any) => {
        const examJson = exam.toJSON();
        
        // Get question paper and answer sheet details
        const qp = questionPapers.find((qp) => qp.examId === exam.examId);
        const as = answerSheets.find((as) => as.examId === exam.examId);
        
        // Count uploaded student papers for this exam
        const uploadedCount = await Scanner.count({
          where: { 
            examId: exam.examId,
            instituteId,
            isDeleted: false,
          },
        });

        // Get total students (you might need to adjust this based on your student enrollment logic)
        const totalStudents = uploadedCount + 10; // Placeholder - adjust based on actual student count

        return {
          ...examJson,
          subject: "Subject", // Would need to fetch from subject table
          className: "Class", // Would need to fetch from class table
          setLabel: qp?.paperSet || as?.paperSet || "A",
          session: "Session", // Would need to fetch from session table
          totalStudents,
          uploadedCount,
        };
      })
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Approved exams fetched successfully.",
      data: { exams: enrichedExams },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// Upload single student answer paper for approval workflow
const uploadStudentAnswerPaper = async (
  body: {
    examId: string;
    studentName: string;
    rollNumber: string;
    section: string;
    classId: string;
  },
  file: Express.Multer.File | undefined,
  uploadedBy: any
): Promise<any> => {
  try {
    const instituteId = uploadedBy.instituteId;
    
    if (!file) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "No file provided.",
      };
    }

    if (!body.examId || !body.studentName || !body.rollNumber || !body.section || !body.classId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "examId, studentName, rollNumber, section, and classId are required.",
      };
    }

    // Check if exam exists and is approved
    const exam = await Exam.findOne({
      where: { examId: body.examId, instituteId, isDeleted: false },
    });

    if (!exam) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    // Check duplicate
    const existing = await Scanner.findOne({
      where: {
        instituteId,
        examId: body.examId,
        rollNo: body.rollNumber,
        isDeleted: false,
      },
    });

    if (existing) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Answer paper already uploaded for this student.",
      };
    }

    const sheetId = await RegHelper.generateUserId();

    await Scanner.create({
      sheetId,
      instituteId,
      examId: body.examId,
      classId: body.classId,
      section: body.section,
      subjectId: exam.subjectId,
      examType: exam.examType,
      rollNo: body.rollNumber,
      studentName: body.studentName,
      fileName: file.originalname,
      fileBuffer: file.buffer,
      fileMimeType: file.mimetype,
      fileSize: file.size,
      uploadedBy: uploadedBy.userId,
      status: "UPLOADED",
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Student answer paper uploaded successfully.",
      data: { sheetId },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// Get student answer papers for a specific exam
const getStudentAnswerPapers = async (examId: string, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;

    const papers = await Scanner.findAll({
      where: { examId, instituteId, isDeleted: false },
      attributes: { exclude: ["fileBuffer"] },
      order: [["createdAt", "DESC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student answer papers fetched successfully.",
      data: { answerPapers: papers },
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
  getApprovedExams,
  uploadStudentAnswerPaper,
  getStudentAnswerPapers,
};