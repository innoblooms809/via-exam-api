import httpStatus from "http-status";
import { Op } from "sequelize";
import Scanner from "../modals/Scanner.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import Exam from "../modals/Exam.modal";
import Class from "../modals/Class.modal";
import Subject from "../modals/Subject.modal";
import Session from "../modals/Session.modal";
import StudentProfile from "../modals/Student.modal";
import UserModal from "../modals/User.modal";
import RegHelper from "../utils/helper";

// Exam-table statuses reached only after the QP + answer key pair is approved.
const APPROVED_EXAM_STATUSES = ["Approved", "Live", "Completed"];
const APPROVED_PAPER_STATUSES: ("APPROVED" | "PUBLISHED")[] = ["APPROVED", "PUBLISHED"];

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

    if (!instituteId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute ID not found for user.",
        data: { exams: [] },
      };
    }

    // Only this institute's exams are candidates — everything below is scoped through these IDs.
    const instituteExams = await Exam.findAll({
      where: { instituteId, isDeleted: false },
      order: [["createdAt", "DESC"]],
    });

    const empty = {
      error: false,
      statusCode: httpStatus.OK,
      message: "No approved exams found.",
      data: { exams: [] },
    };
    if (instituteExams.length === 0) return empty;

    const instituteExamIds = instituteExams.map((e) => e.examId);

    const questionPapers = await QuestionPaper.findAll({
      where: { examId: { [Op.in]: instituteExamIds }, status: { [Op.in]: APPROVED_PAPER_STATUSES } },
      attributes: ["paperId", "examId", "paperSet", "status", "approvedAt"],
    });
    const approvedPaperIds = questionPapers.map((qp) => qp.paperId);

    // Answer keys are linked to the exam either directly or through their question paper.
    const answerKeys = await QuestionPaperAnswer.findAll({
      where: {
        status: { [Op.in]: APPROVED_PAPER_STATUSES },
        [Op.or]: [
          { examId: { [Op.in]: instituteExamIds } },
          ...(approvedPaperIds.length > 0 ? [{ paperId: { [Op.in]: approvedPaperIds } }] : []),
        ],
      },
      attributes: ["paperId", "examId", "paperSet", "status", "approvedAt"],
    });

    // Same rule as the approval workflow: the exam is approved once both its
    // question paper and answer key are approved (or the exam itself says so).
    const approved = instituteExams
      .map((exam) => {
        const qp = questionPapers.find((p) => p.examId === exam.examId);
        const ans = answerKeys.find(
          (a) => a.examId === exam.examId || (qp && a.paperId === qp.paperId)
        );
        const isApproved =
          APPROVED_EXAM_STATUSES.includes(exam.status) ||
          (exam.status !== "Rejected" && Boolean(qp && ans));
        return isApproved ? { exam, qp, ans } : null;
      })
      .filter(Boolean) as { exam: Exam; qp?: QuestionPaper; ans?: QuestionPaperAnswer }[];

    if (approved.length === 0) return empty;

    const exams = approved.map((a) => a.exam);
    const unique = (ids: (string | null | undefined)[]) =>
      Array.from(new Set(ids.filter(Boolean))) as string[];
    const approvedExamIds = exams.map((e) => e.examId);
    const classIds = unique(exams.map((e) => e.classId));
    const subjectIds = unique(exams.map((e) => e.subjectId));
    const sessionIds = unique(exams.map((e) => e.sessionId));
    const userIds = unique(exams.flatMap((e) => [e.teacherId, e.examinerId]));

    const [classesList, subjectsList, sessionsList, usersList, uploadCounts, studentCounts] =
      await Promise.all([
        classIds.length ? Class.findAll({ where: { classId: { [Op.in]: classIds } } }) : [],
        subjectIds.length ? Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds } } }) : [],
        sessionIds.length ? Session.findAll({ where: { sessionId: { [Op.in]: sessionIds } } }) : [],
        userIds.length
          ? UserModal.findAll({
              where: { userId: { [Op.in]: userIds }, instituteId },
              attributes: ["userId", "userName"],
            })
          : [],
        Scanner.count({
          where: { instituteId, examId: { [Op.in]: approvedExamIds }, isDeleted: false },
          group: ["examId"],
        }),
        classIds.length
          ? StudentProfile.count({
              where: { instituteId, classId: { [Op.in]: classIds } },
              group: ["classId"],
            })
          : [],
      ]);

    const classMap = new Map<string, string>(classesList.map((c: any) => [c.classId, c.className]));
    const subjectMap = new Map<string, any>(subjectsList.map((s: any) => [s.subjectId, s]));
    const sessionMap = new Map<string, string>(sessionsList.map((s: any) => [s.sessionId, s.sessionName]));
    const userMap = new Map<string, string>(usersList.map((u: any) => [u.userId, u.userName]));
    const uploadMap = new Map<string, number>(
      (uploadCounts as any[]).map((r) => [r.examId, Number(r.count)])
    );
    const studentMap = new Map<string, number>(
      (studentCounts as any[]).map((r) => [r.classId, Number(r.count)])
    );

    const enrichedExams = approved.map(({ exam, qp, ans }) => {
      const subject = subjectMap.get(exam.subjectId);
      return {
        examId: exam.examId,
        examName: exam.examType,
        examType: exam.examType,
        classId: exam.classId,
        className: exam.classId ? classMap.get(exam.classId) || exam.classId : "All Classes",
        subjectId: exam.subjectId,
        subject: subject?.subjectName || exam.subjectId,
        subjectCode: subject?.subjectCode || "",
        sessionId: exam.sessionId,
        session: sessionMap.get(exam.sessionId) || exam.sessionId,
        teacherName: userMap.get(exam.teacherId) || "",
        examinerName: exam.examinerId ? userMap.get(exam.examinerId) || "" : "",
        setLabel: qp?.paperSet || ans?.paperSet || "",
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        duration: exam.duration,
        instructions: exam.instructions,
        totalStudents: exam.classId ? studentMap.get(exam.classId) || 0 : 0,
        uploadedCount: uploadMap.get(exam.examId) || 0,
        status: exam.status,
        questionPaperStatus: qp?.status || null,
        answerKeyStatus: ans?.status || null,
        approvedAt: qp?.approvedAt || ans?.approvedAt || exam.updatedAt,
        createdAt: exam.createdAt,
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Approved exams fetched successfully.",
      data: { exams: enrichedExams },
    };
  } catch (e: any) {
    console.error("getApprovedExams Error:", e);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
      data: { exams: [] },
    };
  }
};

// Upload single student answer paper for approval workflow
const uploadStudentAnswerPaper = async (
  body: {
    examId: string;
    studentName: string;
    rollNumber: string;
    section?: string;
    classId?: string;
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

    if (!body.examId || !body.studentName || !body.rollNumber) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "examId, studentName, and rollNumber are required.",
      };
    }

    // Check if exam exists
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

    const classId = body.classId || exam.classId || "ALL";
    const section = body.section || "A";

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
      classId,
      section,
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