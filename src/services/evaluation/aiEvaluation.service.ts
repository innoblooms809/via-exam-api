import httpStatus from "http-status";
import Scanner from "../../models/Scanner.model";
import Exam from "../../models/Exam.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import { studentForSheet } from "../student/enrollment.service";
import User from "../../models/User.model";
import Class from "../../models/Class.model";
import logger from "../../config/logger";
import { getSheetQueueInfo } from "./pipeline6.service";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import { pageInfo, paging } from "../../utils/pagination";
import { logMarksChange } from "../academic/marks.service";
import { MARKS_CHANGE, MARKS_SOURCE } from "../../models/MarksAudit.model";
import { sheetEvaluationLock } from "./evaluationLock.service";
import { questionChanges } from "../../utils/questionMarks";

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

    // The exam the sheet was uploaded for: its real subject, class, section and session.
    let examInfo: any = null;
    try {
      const sheet = await Scanner.findOne({ where: { sheetId }, attributes: ["examId", "section"] });
      const exam: any = await Exam.findOne({
        where: { examId: sheet?.examId || aiEval.examId },
        attributes: ["examId", "examType"],
        include: [
          { association: "subject", attributes: ["subjectName"] },
          { association: "class", attributes: ["className"] },
          { association: "section", attributes: ["sectionName"] },
          { association: "session", attributes: ["sessionName"] },
        ],
      });
      if (exam) {
        examInfo = {
          examId: exam.examId,
          examType: exam.examType,
          subjectName: exam.subject?.subjectName ?? null,
          className: exam.class?.className ?? null,
          // A whole-class exam has no section: the sheet's own section.
          sectionName: exam.section?.sectionName ?? sheet?.section ?? null,
          sessionName: exam.session?.sessionName ?? null,
        };
      }
    } catch (err) {
      logger.error("Failed to resolve the exam for evaluation details:", err);
    }

    const evalDataJson = aiEval.toJSON() as any;
    evalDataJson.studentName = studentName;
    evalDataJson.className = examInfo?.className || className;
    evalDataJson.exam = examInfo;
    evalDataJson.subjectName = examInfo?.subjectName ?? null;
    evalDataJson.sessionName = examInfo?.sessionName ?? null;
    // While Pending: where the sheet is in the Pipeline 6 queue (stage + place in line).
    evalDataJson.queue = await getSheetQueueInfo(sheetId);

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
    // Published, in an open cross-check, or a section its evaluator marked completed: the marks stay
    // (evaluationLock.service). The answer names the lock, so the screen shows it as locked.
    const teacher = String(user?.role?.role ?? user?.role ?? "").toUpperCase().includes("TEACH");
    const lock = await sheetEvaluationLock(sheetId, { teacher, forEdit: true });
    if (lock) {
      return { error: true, statusCode: httpStatus.CONFLICT, message: lock.message, data: { lock: lock.reason } };
    }

    const before = aiEval.totalScore == null ? null : Number(aiEval.totalScore);
    // Which questions' marks this edit changes (the marks history shows them).
    const details = Array.isArray(data.evaluations) ? questionChanges(aiEval.evaluations, data.evaluations) : [];
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
      const totalChanged = score !== null && (before === null || Math.abs(before - score) >= 0.005);
      if ((totalChanged || details.length) && user?.userId) {
        await logMarksChange(
          {
            instituteId: sheet?.instituteId ?? exam?.instituteId ?? user.instituteId,
            what: MARKS_CHANGE.STUDENT,
            source: MARKS_SOURCE.EVALUATION,
            changedBy: user.userId,
            oldValue: before,
            newValue: score ?? before,
            details,
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

//// ─── GET FAILED EVALUATIONS ───────────────────────────────────────────────────
// Answer sheets where AI evaluation has failed (status = 'Failed'), with the exam, class, subject,
// student and error, so admins can see what to re-run. Paged on the server:
//
//   ?sessionId&examId          the set the page and its figures describe
//   ?exam=<examId>&className   table filters (the figures and the filter options ignore them)
//   ?search                    student, roll, subject, class, file name or error
//   ?sort=failedAt|subject|student|place &order=asc|desc   (default: newest failure first)
//   ?page&limit                25 a page, at most 200
//
// → { items, total, pagination, summary: { total, exams, classes }, facets: { exams, classes } }
// The sheet's file link is not in the list: the viewer asks for the file when a row is opened.
const FAILED_SORTS: Record<string, string[]> = {
  failedAt: [`"failedAt"`],
  subject: [`lower(COALESCE("subjectName", ''))`],
  student: [`lower(COALESCE("studentName", ''))`],
  place: [`lower(COALESCE("className", ''))`, `lower(COALESCE("sectionName", section, ''))`],
};

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);

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

    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const examId = str(query?.examId);
    const sessionId = str(query?.sessionId);
    const examFilter = str(query?.exam);
    const classFilter = str(query?.className);
    const search = str(query?.search).slice(0, 100);
    const sortKey = FAILED_SORTS[str(query?.sort)] ? str(query?.sort) : "failedAt";
    const askedOrder = str(query?.order).toLowerCase();
    const order = askedOrder === "asc" ? "ASC" : askedOrder === "desc" ? "DESC" : sortKey === "failedAt" ? "DESC" : "ASC";
    const { page, limit, offset } = paging(query, { defaultLimit: 25, maxLimit: 200, unpagedLimit: 200 });

    // One row per failed evaluation.
    const scoped = `
      WITH failed AS (
        SELECT DISTINCT ON (e.id)
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
        LEFT JOIN viaexam_sections sec ON sec."sectionId" = ex."sectionId" OR (
          sec."instituteId" = sh."instituteId"
          AND sec."classId" = COALESCE(ex."classId", sh."classId", e."classId")
          AND sec."sectionName" = COALESCE(sh.section, e.section)
          AND sec."isDeleted" = false
        )
        LEFT JOIN viaexam_sessions sess ON sess."sessionId" = ex."sessionId"
        LEFT JOIN viaexam_users u ON u."userId" = e."studentId"
        LEFT JOIN viaexam_student_profiles sp ON sp."userId" = e."studentId"
        LEFT JOIN viaexam_student_enrollments en ON en."studentId" = e."studentId" AND en."sessionId" = ex."sessionId"
        LEFT JOIN viaexam_users uploader ON uploader."userId" = sh."uploadedBy"
        WHERE sh."instituteId" = :inst
          AND e.status = 'Failed'
          ${examId ? 'AND (ex."examId" = :examId OR sh."examId" = :examId OR e."examId" = :examId)' : ""}
          ${sessionId ? 'AND (ex."sessionId" = :sessionId OR sess."sessionId" = :sessionId)' : ""}
        -- A sheet without its exam id can match more than one exam: its own exam first, then the newest.
        ORDER BY e.id, (ex."examId" = sh."examId") DESC NULLS LAST, (sec."sectionId" = ex."sectionId") DESC NULLS LAST, ex."createdAt" DESC NULLS LAST
      )`;

    const filters: string[] = [];
    if (examFilter) filters.push(`"examId" = :examFilter`);
    if (classFilter) filters.push(`"className" = :classFilter`);
    if (search) {
      filters.push(`concat_ws(' ', "studentName", "rollNumber", "rollNo", "subjectName", "error", "fileName", "className") ILIKE :search`);
    }
    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const replacements = { inst, examId, sessionId, examFilter, classFilter, search: `%${escapeLike(search)}%`, limit, offset };
    const orderBy = [...FAILED_SORTS[sortKey].map((col) => `${col} ${order}`), `"failedAt" DESC`, "id"].join(", ");

    const [found, figures, examFacets, classFacets] = await Promise.all([
      sequelize.query<any>(
        `${scoped}
        SELECT *, COUNT(*) OVER()::int AS "__total" FROM failed ${where}
        ORDER BY ${orderBy}
        LIMIT :limit OFFSET :offset`,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query<any>(
        `${scoped}
        SELECT COUNT(*)::int AS total, COUNT(DISTINCT "examId")::int AS exams, COUNT(DISTINCT "className")::int AS classes FROM failed`,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query<any>(
        `${scoped}
        SELECT "examId", MIN("subjectName") AS "subjectName", MIN(COALESCE("examTypeName", "examType")) AS "examType"
        FROM failed WHERE "examId" IS NOT NULL AND "subjectName" IS NOT NULL
        GROUP BY "examId" ORDER BY 2, 3`,
        { replacements, type: QueryTypes.SELECT }
      ),
      sequelize.query<any>(
        `${scoped}
        SELECT DISTINCT "className" FROM failed WHERE "className" IS NOT NULL ORDER BY 1`,
        { replacements, type: QueryTypes.SELECT }
      ),
    ]);

    const items = found.map(({ __total, ...row }: any) => row);
    // A page past the end (rows fixed since) still says how many rows match.
    let total: number = found[0]?.__total ?? 0;
    if (!found.length && page > 1) {
      const [count] = await sequelize.query<any>(`${scoped} SELECT COUNT(*)::int AS n FROM failed ${where}`, { replacements, type: QueryTypes.SELECT });
      total = count?.n ?? 0;
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Failed evaluations fetched successfully.",
      data: {
        items,
        total,
        pagination: pageInfo(total, page, limit),
        summary: figures[0] ?? { total: 0, exams: 0, classes: 0 },
        facets: {
          exams: examFacets.map((r: any) => ({ examId: r.examId, subjectName: r.subjectName, examType: r.examType })),
          classes: classFacets.map((r: any) => r.className),
        },
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
  getEvaluationBySheetId,
  updateEvaluationBySheetId,
  getFailedEvaluations,
};

