import httpStatus from "http-status";
import { Op } from "sequelize";
import Scanner from "../../models/Scanner.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import QuestionPaperAnswer from "../../models/question-paper/StandardAnswer.model";
import Exam from "../../models/Exam.model";
import Class from "../../models/Class.model";
import Subject from "../../models/Subject.model";
import Session from "../../models/Session.model";
import StudentEnrollment from "../../models/StudentEnrollment.model";
import UserModal from "../../models/User.model";
import RegHelper from "../../utils/helper";
import { isScannerRequester, isTeacherRequester, requireSheetAccess, scopeSheetRows } from "../evaluation/evaluationAccess.service";
import AnswerSheetStorage from "../answer-sheet/answerSheetStorage.service";
import { newId } from "../../utils/idGenerator";
import { assertSheetWritable, clearAbsentForRoll } from "../exam/examWorkflow.service";
import { rosterRolls } from "../exam/examRoster.service";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";
import {
  destroyAnswerSheet,
  removeTempFile,
  uploadAnswerSheet,
} from "../../utils/answerSheetStorage";
import { beginQualityCheck, qualitySummary, scanQualityRule, settleQualityCheck } from "../answer-sheet/sheetQuality.service";

// Exam-table statuses reached only after the QP + answer key pair is approved.
const APPROVED_EXAM_STATUSES = ["Approved", "Live", "Completed"];
const APPROVED_PAPER_STATUSES: ("APPROVED" | "PUBLISHED")[] = ["APPROVED", "PUBLISHED"];

// ─── UPLOAD (single or bulk) ──────────────────────────────────────────────────
// Storage lives in answerSheetStorage.service.ts: scans now go to Cloudinary
// rather than a Postgres BLOB, and keeping the row, the remote asset and the
// temp file in step needs its own module.
const uploadSheets = AnswerSheetStorage.uploadSheets;

// ─── REPLACE ONE SHEET ────────────────────────────────────────────────────────
const replaceSheet = AnswerSheetStorage.replaceSheet;

/** Sheet statuses that come from evaluation, hidden from scanner staff. */
const SCANNER_HIDDEN_STATUSES = new Set(["Evaluated", "Evaluating", "Failed"]);

const getAllSheets = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const { classId, section, subjectId, examType, rollNo, status, sheetId, examId } = query;

    const where: any = { instituteId, isDeleted: false };
    if (classId) where.classId = classId;
    if (section) where.section = section;
    if (subjectId) where.subjectId = subjectId;
    if (examType) where.examType = examType;
    if (rollNo) where.rollNo = rollNo;
    if (status) where.status = status;
    if (sheetId) where.sheetId = sheetId;
    if (examId) where.examId = examId;

    // Never return fileBuffer in list — too heavy
    const sheets = await Scanner.findAll({
      where,
      attributes: { exclude: ["fileBuffer"] },
      order: [["createdAt", "DESC"]],
    });

    const sheetIds = sheets.map((s: any) => s.sheetId);
    // Scanner staff never see evaluation: their sheets carry no AI status or score.
    const scanner = isScannerRequester(requestedBy);
    const aiEvals =
      sheetIds.length > 0 && !scanner
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
      if (scanner) {
        // A status the evaluation set reads as plain "uploaded" to them.
        if (SCANNER_HIDDEN_STATUSES.has(String(s.status))) s.status = "Uploaded";
        return s;
      }
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

    // Teachers only see sheets of their own class subjects (real names) or of exams
    // they were assigned to evaluate (names masked).
    let visibleSheets = await scopeSheetRows(requestedBy, enrichedSheets);
    // Looking a sheet up by real roll number would reveal a masked student.
    if (rollNo && isTeacherRequester(requestedBy)) visibleSheets = visibleSheets.filter((s: any) => !s.identityMasked);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sheets fetched successfully.",
      data: { sheets: visibleSheets, total: visibleSheets.length },
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

const getSheetFile = AnswerSheetStorage.getSheetFile;

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

// Soft-deletes the row and destroys the stored scan once the change commits.
const deleteSheet = AnswerSheetStorage.deleteSheet;

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

    // Collect all approved exam sets. An exam can have multiple approved paper sets (A, B, etc.)
    const approvedList: {
      exam: Exam;
      qp?: QuestionPaper;
      ans?: QuestionPaperAnswer;
      paperSet: string;
    }[] = [];

    for (const exam of instituteExams) {
      const examQps = questionPapers.filter((p) => p.examId === exam.examId);
      const examAns = answerKeys.filter(
        (a) => a.examId === exam.examId || examQps.some((q) => a.paperId === q.paperId)
      );

      // Collect unique paperSet names from approved QPs and Answer Keys for this exam
      const setNames = Array.from(
        new Set(
          [
            ...examQps.map((q) => q.paperSet),
            ...examAns.map((a) => a.paperSet),
          ].filter((s) => Boolean(s && String(s).trim() !== ""))
        )
      );

      if (setNames.length > 0) {
        for (const set of setNames) {
          const qp = examQps.find((q) => q.paperSet === set);
          const ans = examAns.find((a) => a.paperSet === set || (qp && a.paperId === qp.paperId));
          const isApproved =
            APPROVED_EXAM_STATUSES.includes(exam.status) ||
            (exam.status !== "Rejected" && Boolean(qp && ans));
          if (isApproved) {
            approvedList.push({ exam, qp, ans, paperSet: set });
          }
        }
      } else {
        if (APPROVED_EXAM_STATUSES.includes(exam.status)) {
          approvedList.push({ exam, paperSet: "" });
        }
      }
    }

    if (approvedList.length === 0) return empty;

    // Exams the admin gave to a scanner are that scanner's alone.
    const assignments = await ExamScannerAssignment.findAll({
      where: { examId: { [Op.in]: Array.from(new Set(approvedList.map((a) => a.exam.examId))) }, isActive: true },
      attributes: ["examId", "scannerId", "status", "completedAt"],
    });
    const assignmentByExam = new Map(assignments.map((a) => [a.examId, a]));
    const isScannerRole = String(requestedBy?.role?.role ?? "").toUpperCase() === "SCANNER";
    if (isScannerRole) {
      for (let i = approvedList.length - 1; i >= 0; i--) {
        const assignment = assignmentByExam.get(approvedList[i].exam.examId);
        if (assignment && assignment.scannerId !== requestedBy.userId) approvedList.splice(i, 1);
      }
      if (approvedList.length === 0) return empty;
    }

    const exams = approvedList.map((a) => a.exam);
    const unique = (ids: (string | null | undefined)[]) =>
      Array.from(new Set(ids.filter(Boolean))) as string[];
    const classIds = unique(exams.map((e) => e.classId));
    const subjectIds = unique(exams.map((e) => e.subjectId));
    const sessionIds = unique(exams.map((e) => e.sessionId));
    const userIds = unique(exams.flatMap((e) => [e.teacherId, e.examinerId]));

    const [classesList, subjectsList, sessionsList, usersList, allSheets, studentCounts] =
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
        Scanner.findAll({
          where: { instituteId, isDeleted: false },
          attributes: ["examId", "classId", "subjectId", "examType"],
        }),
        // Students per class in each exam's own session.
        classIds.length && sessionIds.length
          ? StudentEnrollment.count({
              where: { instituteId, classId: { [Op.in]: classIds }, sessionId: { [Op.in]: sessionIds }, isActive: true },
              group: ["sessionId", "classId"],
            })
          : [],
      ]);

    const classMap = new Map<string, string>(classesList.map((c: any) => [c.classId, c.className]));
    const subjectMap = new Map<string, any>(subjectsList.map((s: any) => [s.subjectId, s]));
    const sessionMap = new Map<string, string>(sessionsList.map((s: any) => [s.sessionId, s.sessionName]));
    const userMap = new Map<string, string>(usersList.map((u: any) => [u.userId, u.userName]));
    const studentMap = new Map<string, number>(
      (studentCounts as any[]).map((r) => [`${r.sessionId}|${r.classId}`, Number(r.count)])
    );

    // Calculate uploaded sheet count per exam, matching by examId OR (classId, subjectId, examType)
    const countUploadedForExam = (exam: Exam) => {
      return allSheets.filter((s: any) => {
        if (s.examId && s.examId === exam.examId) return true;
        if (
          s.classId === exam.classId &&
          s.subjectId === exam.subjectId &&
          s.examType === exam.examType
        ) {
          return true;
        }
        return false;
      }).length;
    };

    const enrichedExams = approvedList.map(({ exam, qp, ans, paperSet }) => {
      const subject = subjectMap.get(exam.subjectId);
      const setLabel = paperSet || qp?.paperSet || ans?.paperSet || "";
      const rowId = setLabel ? `${exam.examId}_${setLabel}` : exam.examId;

      return {
        id: rowId,
        examId: rowId,
        rawExamId: exam.examId,
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
        setLabel,
        totalMarks: exam.totalMarks,
        passingMarks: exam.passingMarks,
        duration: exam.duration,
        instructions: exam.instructions,
        totalStudents: exam.classId ? studentMap.get(`${exam.sessionId}|${exam.classId}`) || 0 : 0,
        uploadedCount: countUploadedForExam(exam),
        status: exam.status,
        questionPaperStatus: qp?.status || null,
        answerKeyStatus: ans?.status || null,
        approvedAt: qp?.approvedAt || ans?.approvedAt || exam.updatedAt,
        createdAt: exam.createdAt,
        scanStatus: assignmentByExam.get(exam.examId)?.status ?? null,
        assignedToMe: assignmentByExam.get(exam.examId)?.scannerId === requestedBy.userId,
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

    // Only the assigned scanner (or an admin) may add sheets, and not after
    // the upload is marked complete or results are published.
    try {
      await assertSheetWritable(uploadedBy, exam.examId);
    } catch (err: any) {
      return { error: true, statusCode: err?.statusCode || httpStatus.FORBIDDEN, message: err?.message };
    }

    const rolls = await rosterRolls(instituteId, exam.examId);
    if (rolls && !rolls.has(String(body.rollNumber).trim())) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Roll number ${body.rollNumber} is not on this exam's roster. Check the roll number, or add the student to the class first.`,
      };
    }

    const classId = body.classId || exam.classId || "ALL";
    const section = body.section || exam.sectionId || "A";

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

    const sheetId = newId("answerSheet");
    const qualityRule = await scanQualityRule(instituteId);
    const qualityCheck = beginQualityCheck(file.path, qualityRule);

    // Same storage path as the batch upload: bytes go to Cloudinary, the row
    // keeps a URL. Multer wrote the file to disk, so nothing is held in memory.
    const stored = await uploadAnswerSheet({
      filePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      instituteId,
      sheetId,
    });

    try {
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
        fileUrl: stored.url,
        filePublicId: stored.publicId,
        fileResourceType: stored.resourceType,
        fileMimeType: file.mimetype,
        fileSize: file.size ?? stored.bytes,
        uploadedBy: uploadedBy.userId,
        status: "UPLOADED",
      });
    } catch (err) {
      // The row never landed, so the asset just uploaded is an orphan.
      await destroyAnswerSheet(stored.publicId, stored.resourceType, `rollback ${sheetId}`);
      throw err;
    }
    await clearAbsentForRoll(body.examId, body.rollNumber, uploadedBy.userId);
    const report = await settleQualityCheck(sheetId, stored.publicId, qualityCheck);

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Student answer paper uploaded successfully.",
      data: { sheetId, quality: qualitySummary(report), qualityPending: qualityRule.enabled && !report },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  } finally {
    await removeTempFile(file?.path);
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