import httpStatus from "http-status";
import Scanner from "../../models/Scanner.model";
import Exam from "../../models/Exam.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import QuestionPaperAnswer from "../../models/question-paper/StandardAnswer.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import { studentForSheet } from "../student/enrollment.service";
import User from "../../models/User.model";
import Class from "../../models/Class.model";
import logger from "../../config/logger";
import axios from "axios";
import { pythonServices } from "../../config/pythonServices";
import { formatQuestionPaper } from "../../utils/questionPaperText";
import { getSheetQueueInfo } from "./pipeline6.service";
import { resolveSheetBuffer } from "../../utils/answerSheetStorage";
import { newId } from "../../utils/idGenerator";
import StudentResult from "../../models/StudentResult.model";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import { logMarksChange } from "../academic/marks.service";
import { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import { sheetHeldForCrossCheck } from "../exam/crossCheck.service";

// ─── TRIGGER EVALUATION ───────────────────────────────────────────────────────
const triggerEvaluation = async (sheetId: string, force: boolean = false): Promise<any> => {
  try {
    // 1. Fetch Scanner Sheet
    const sheet = await Scanner.findOne({
      where: { sheetId, isDeleted: false },
    });

    if (!sheet) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Answer sheet not found.",
      };
    }

    // 2. Check if already evaluating or completed
    let aiEval = await AIEvaluation.findOne({ where: { sheetId } });
    if (aiEval && aiEval.status === "Success" && !force) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "Sheet already evaluated.",
        data: aiEval,
      };
    }

    if (aiEval && aiEval.status === "Pending" && !force) {
      const timeElapsed = Date.now() - new Date(aiEval.updatedAt!).getTime();
      if (timeElapsed < 180000) { // 3 minutes
        return {
          error: false,
          statusCode: httpStatus.OK,
          message: "Evaluation is already in progress.",
          data: aiEval,
        };
      }
      logger.info(`Sheet ${sheetId} has been stuck in Pending for ${Math.round(timeElapsed / 1000)}s. Overriding and starting fresh evaluation.`);
    }

    // Lookup Student
    // The student with this roll number in the sheet's class and section, in its exam's session.
    const ownerId = await studentForSheet(sheet);
    const studentId = ownerId ?? `STUDENT-${sheet.rollNo}`;

    // 3. Find or Create AIEvaluation record as Pending
    const evaluationId = newId("evaluation");
    if (!aiEval) {
      aiEval = await AIEvaluation.create({
        evaluationId,
        sheetId,
        studentId,
        examId: sheet.examType, // using the scan examType as exam identifier
        classId: sheet.classId,
        section: sheet.section,
        subjectId: sheet.subjectId,
        examType: sheet.examType,
        status: "Pending",
        totalScore: 0,
        feedback: "",
        evaluations: [],
        studentAnsOcr: "",
        standardAnsOcr: "",
        questionOcr: "",
      });
    } else {
      await aiEval.update({
        status: "Pending",
        error: undefined,
      });
    }

    // 4. Resolve Exam and Question Paper details
    let examId = sheet.examType;
    let maxMarks = 10;
    let questionText = "Evaluate the student's answer sheet.";
    let standardAnsText = "Provide feedback and score according to subject correctness.";

    // Try to find the matching Exam (ordered by latest created)
    const exam = await Exam.findOne({
      where: {
        instituteId: sheet.instituteId,
        classId: sheet.classId,
        subjectId: sheet.subjectId,
        examType: sheet.examType,
        isDeleted: false,
      },
      order: [["createdAt", "DESC"]],
    });

    if (exam) {
      examId = exam.examId;
      maxMarks = exam.totalMarks || 10;

      // Target paperSet from student sheet section (e.g. "A", "B", etc.)
      const targetPaperSet = sheet.section || "A";

      // 1. Try matching exact paperSet for this exam & section
      let questionPaper = await QuestionPaper.findOne({
        where: {
          examId: exam.examId,
          instituteId: sheet.instituteId,
          paperSet: targetPaperSet,
        },
        order: [["createdAt", "DESC"]],
      });

      // 2. Fallback: if no paperSet match for this examId, try finding any QuestionPaper for this examId
      if (!questionPaper) {
        logger.info(`No QuestionPaper found for examId '${exam.examId}' and paperSet '${targetPaperSet}'. Fetching latest QuestionPaper for examId '${exam.examId}'.`);
        questionPaper = await QuestionPaper.findOne({
          where: {
            examId: exam.examId,
            instituteId: sheet.instituteId,
          },
          order: [["createdAt", "DESC"]],
        });
      }

      if (questionPaper) {
        // Find matching answers from QuestionPaperAnswer for paperId & paperSet
        let qpAnswer = await QuestionPaperAnswer.findOne({
          where: {
            paperId: questionPaper.paperId,
            paperSet: questionPaper.paperSet,
          },
        });
        if (!qpAnswer) {
          qpAnswer = await QuestionPaperAnswer.findOne({
            where: { paperId: questionPaper.paperId },
          });
        }
        const ansDoc = qpAnswer ? qpAnswer.answers : null;

        const { questions, answers } = formatQuestionPaper(questionPaper.content, ansDoc);
        if (questions) questionText = questions;
        if (answers) standardAnsText = answers;
      }
    }

    // 5. Run evaluation asynchronously in the background
    runBackgroundEvaluation(
      sheet,
      aiEval,
      studentId,
      examId,
      maxMarks,
      questionText,
      standardAnsText
    ).catch((err) => {
      logger.error("Background evaluation trigger failed:", err);
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "AI evaluation triggered successfully.",
      data: aiEval,
    };

  } catch (error: any) {
    console.error("AI Evaluation initialization failed:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to initialize evaluation: ${error.message}`,
    };
  }
};

// Helper function to execute OCR & Evaluation in the background
const runBackgroundEvaluation = async (
  sheet: any,
  aiEval: any,
  studentId: string,
  examId: string,
  maxMarks: number,
  questionText: string,
  standardAnsText: string
): Promise<void> => {
  try {
    // 1. Resolve the sheet's bytes — Cloudinary-backed sheets keep fileBuffer
    // null, so fetch the stored file before anything below reads it. This
    // assigns onto the in-memory instance only; sheet.update() further down
    // passes an explicit field list and never persists this back.
    sheet.fileBuffer = await resolveSheetBuffer(sheet);
    if (!sheet.fileBuffer || sheet.fileBuffer.length === 0) {
      throw new Error("Answer sheet image file buffer is missing or empty in database.");
    }

    // Ensure filename has a valid extension (.png, .jpg, .jpeg, .webp, .pdf) for python ocr_server
    let fileName = sheet.fileName || "sheet.png";
    if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
      const ext = sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
      fileName = `${fileName}${ext}`;
    }

    // Call OCR API
    const ocrApiUrl = pythonServices.ocrUrl();
    const ocrFormData = new FormData();
    const fileBlob = new Blob([sheet.fileBuffer], { type: sheet.fileMimeType || "image/png" });
    ocrFormData.append("file", fileBlob, fileName);

    logger.info(`Sending student answer sheet (${fileName}, ${sheet.fileBuffer.length} bytes) to OCR API: ${ocrApiUrl}`);
    const ocrResponse = await axios.post(ocrApiUrl, ocrFormData, {
      timeout: 3600000, // 1 hour
    });

    const ocrResult = ocrResponse.data;
    const studentAnsOcr = ocrResult.combined_markdown || "";
    logger.info("OCR completed successfully (background).");

    // 2. Call Evaluation API
    const evaluationApiUrl = pythonServices.evaluationUrl();
    const evalFormData = new FormData();
    evalFormData.append("student_id", studentId);
    evalFormData.append("exam_id", examId);
    evalFormData.append("question", questionText);
    evalFormData.append("expected_answer", standardAnsText);
    evalFormData.append("student_answer", studentAnsOcr);
    evalFormData.append("max_marks", String(maxMarks));

    logger.info(`Sending extracted text to Evaluation API (background): ${evaluationApiUrl}`);
    const evalResponse = await axios.post(evaluationApiUrl, evalFormData, {
      timeout: 3600000, // 1 hour
    });

    const evalResult = evalResponse.data;
    logger.info("Evaluation completed successfully (background).");

    // 3. Save Successful Evaluation Details
    await aiEval.update({
      status: "Success",
      totalScore: evalResult.total_score || 0,
      feedback: evalResult.feedback || "",
      evaluations: evalResult.evaluations || [],
      studentAnsOcr: studentAnsOcr,
      standardAnsOcr: standardAnsText,
      questionOcr: questionText,
      error: null, // clear previous errors if any
    });

    // 4. Update Scanner sheet status to Evaluated
    await sheet.update({ status: "Evaluated" });

  } catch (error: any) {
    const detailMsg =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      (typeof error?.response?.data === "string" ? error.response.data : null) ||
      error?.message ||
      "Unknown error occurred during background AI evaluation.";

    logger.error(`AI Evaluation background job failed for sheet ${sheet.sheetId}:`, {
      message: error.message,
      responseData: error?.response?.data,
      status: error?.response?.status,
    });

    // Update status as Failed with full error detail
    await aiEval.update({
      status: "Failed",
      error: detailMsg,
    });
  }
};

// ─── GET EVALUATION BY SHEET ID ───────────────────────────────────────────────
const getEvaluationBySheetId = async (sheetId: string): Promise<any> => {
  try {
    const aiEval = await AIEvaluation.findOne({ where: { sheetId } });
    if (!aiEval) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Evaluation details not found for this sheet.",
      };
    }

    let studentName = "";
    let className = "";

    try {
      const student = await User.findOne({ where: { userId: aiEval.studentId } });
      if (student) {
        studentName = student.userName;
      }
    } catch (err) {
      logger.error("Failed to resolve student name for evaluation details:", err);
    }

    try {
      const classObj = await Class.findOne({ where: { classId: aiEval.classId } });
      if (classObj) {
        className = classObj.className;
      }
    } catch (err) {
      logger.error("Failed to resolve class name for evaluation details:", err);
    }

    const evalDataJson = aiEval.toJSON() as any;
    evalDataJson.studentName = studentName;
    evalDataJson.className = className;
    // While Pending: where the sheet is in the Pipeline 6 queue (stage + place in line).
    evalDataJson.queue = getSheetQueueInfo(sheetId);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation details fetched.",
      data: evalDataJson,
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

// ─── GET ALL EVALUATIONS (list with filters) ──────────────────────────────────
const getAllEvaluations = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const { classId, section, subjectId, examType, status } = query;
    const where: any = {};

    if (classId) where.classId = classId;
    if (section) where.section = section;
    if (subjectId) where.subjectId = subjectId;
    if (examType) where.examType = examType;
    if (status) where.status = status;

    const evaluations = await AIEvaluation.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "AI evaluations list fetched successfully.",
      data: { evaluations, total: evaluations.length },
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

// ─── UPDATE EVALUATION BY SHEET ID ────────────────────────────────────────────
// An evaluator corrects the AI's marks. The marks stay within the exam's maximum, every
// change is logged with who made it, and once results are published marks only change
// through a recheck (so what students see always has a trail).
const updateEvaluationBySheetId = async (
  sheetId: string,
  data: { totalScore: number; evaluations: any; feedback?: string; reason?: string },
  user?: any
): Promise<any> => {
  try {
    const aiEval = await AIEvaluation.findOne({ where: { sheetId } });
    if (!aiEval) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Evaluation details not found for this sheet.",
      };
    }

    const sheet = await Scanner.findOne({ where: { sheetId }, attributes: ["examId", "instituteId", "classId", "section", "rollNo"] });
    const exam = sheet?.examId ? await Exam.findOne({ where: { examId: sheet.examId } }) : null;
    const score = data.totalScore === undefined || data.totalScore === null ? null : Number(data.totalScore);
    if (score !== null && (!Number.isFinite(score) || score < 0 || (exam && score > exam.totalMarks))) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: `Marks must be between 0 and ${exam?.totalMarks ?? "the paper's maximum"}.` };
    }
    if (exam && (await StudentResult.count({ where: { examId: exam.examId, isDeleted: false } }))) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "This exam's results are published, so marks change only through a recheck (Results → Recheck requests).",
      };
    }

    const held = await sheetHeldForCrossCheck(sheetId);
    if (held && String(user?.role?.role ?? user?.role ?? "").toUpperCase().includes("TEACH")) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "This sheet is being cross-checked. Its marks change only through the cross-checker's verdict until that's done.",
      };
    }

    const before = aiEval.totalScore == null ? null : Number(aiEval.totalScore);
    // Whose marks these are, from the sheet's enrolment (the evaluation's own studentId can be
    // someone else's), so the marks history names the right student.
    const ownerId = sheet ? await studentForSheet(sheet) : null;
    await sequelize.transaction(async (t) => {
      await aiEval.update(
        {
          ...(score !== null ? { totalScore: score } : {}),
          evaluations: data.evaluations,
          feedback: data.feedback !== undefined ? data.feedback : aiEval.feedback,
        },
        { transaction: t }
      );
      if (score !== null && (before === null || Math.abs(before - score) >= 0.005) && user?.userId) {
        await logMarksChange(
          {
            instituteId: sheet?.instituteId ?? exam?.instituteId ?? user.instituteId,
            what: MARKS_CHANGE.STUDENT,
            source: MARKS_SOURCE.EVALUATION,
            changedBy: user.userId,
            oldValue: before,
            newValue: score,
            reason: data.reason ?? null,
            sessionId: exam?.sessionId ?? null,
            examType: exam?.examType ?? null,
            examId: exam?.examId ?? null,
            subjectId: exam?.subjectId ?? null,
            studentId: ownerId,
            sheetId,
          },
          t
        );
      }
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation details updated successfully.",
      data: aiEval,
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

// ─── GET FAILED EVALUATIONS ───────────────────────────────────────────────────
// Answer sheets where AI evaluation has failed (status = 'Failed').
// Returns full sheet, exam, class, subject, student, and error details so admins
// can inspect and re-trigger AI evaluation.
const getFailedEvaluations = async (user: any, query?: any): Promise<any> => {
  try {
    const inst = user?.instituteId;
    if (!inst) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute ID is required.",
      };
    }

    const examId = query?.examId;
    const sessionId = query?.sessionId;

    const rows: any[] = await sequelize.query(
      `SELECT
        e.id,
        e."evaluationId",
        e."sheetId",
        e."studentId",
        COALESCE(ex."examId", sh."examId", e."examId") AS "examId",
        COALESCE(ex."classId", sh."classId", e."classId") AS "classId",
        COALESCE(sh.section, e.section) AS "section",
        COALESCE(ex."subjectId", sh."subjectId", e."subjectId") AS "subjectId",
        COALESCE(ex."examType", sh."examType", e."examType") AS "examType",
        e.status,
        e.error,
        e."totalScore",
        e.feedback,
        e."createdAt",
        e."updatedAt" AS "failedAt",
        sh."rollNo",
        sh."fileName",
        sh."fileUrl",
        sh."fileMimeType",
        sh."fileSize",
        sh."status" AS "sheetStatus",
        sh."uploadedBy",
        sh."createdAt" AS "uploadedAt",
        uploader."userName" AS "uploadedByName",
        COALESCE(u."userName", sh."studentName", 'Student') AS "studentName",
        COALESCE(en."rollNumber", sp."rollNumber", sh."rollNo") AS "rollNumber",
        ex."examDate",
        ex."examType" AS "examTypeName",
        ex."totalMarks",
        ex.status AS "examStatus",
        sub."subjectName",
        sub."subjectCode",
        c."className",
        sec."sectionName",
        sess."sessionId",
        sess."sessionName"
      FROM viaexam_ai_evaluations e
      JOIN viaexam_answer_sheets sh ON sh."sheetId" = e."sheetId" AND sh."isDeleted" = false
      LEFT JOIN viaexam_exams ex ON (
        ex."examId" = COALESCE(NULLIF(sh."examId", ''), NULLIF(e."examId", ''))
        OR (
          (sh."examId" IS NULL OR sh."examId" = '' OR sh."examId" = sh."examType")
          AND ex."instituteId" = sh."instituteId"
          AND ex."classId" = COALESCE(sh."classId", e."classId")
          AND ex."subjectId" = COALESCE(sh."subjectId", e."subjectId")
          AND ex."examType" = COALESCE(sh."examType", e."examType")
          AND ex."isDeleted" = false
        )
      ) AND ex."isDeleted" = false
      LEFT JOIN viaexam_subjects sub ON sub."subjectId" = COALESCE(ex."subjectId", sh."subjectId", e."subjectId")
      LEFT JOIN viaexam_classes c ON c."classId" = COALESCE(ex."classId", sh."classId", e."classId")
      LEFT JOIN viaexam_sections sec ON sec."sectionId" = ex."sectionId" OR (sec."instituteId" = sh."instituteId" AND sec."sectionName" = COALESCE(sh.section, e.section))
      LEFT JOIN viaexam_sessions sess ON sess."sessionId" = ex."sessionId"
      LEFT JOIN viaexam_users u ON u."userId" = e."studentId"
      LEFT JOIN viaexam_student_profiles sp ON sp."userId" = e."studentId"
      LEFT JOIN viaexam_student_enrollments en ON en."studentId" = e."studentId" AND en."sessionId" = ex."sessionId"
      LEFT JOIN viaexam_users uploader ON uploader."userId" = sh."uploadedBy"
      WHERE sh."instituteId" = :inst
        AND e.status = 'Failed'
        ${examId ? 'AND (ex."examId" = :examId OR sh."examId" = :examId OR e."examId" = :examId)' : ""}
        ${sessionId ? 'AND (ex."sessionId" = :sessionId OR sess."sessionId" = :sessionId)' : ""}
      ORDER BY e."updatedAt" DESC`,
      {
        replacements: { inst, ...(examId ? { examId } : {}), ...(sessionId ? { sessionId } : {}) },
        type: QueryTypes.SELECT,
      }
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Failed evaluations fetched successfully.",
      data: {
        items: rows,
        total: rows.length,
      },
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

export default {
  triggerEvaluation,
  getEvaluationBySheetId,
  getAllEvaluations,
  updateEvaluationBySheetId,
  getFailedEvaluations,
};

