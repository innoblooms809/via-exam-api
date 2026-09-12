import { Request, Response } from "express";
import {
  Op,
  ForeignKeyConstraintError,
  UniqueConstraintError,
  ValidationError,
} from "sequelize";
import { QuestionPaperService } from "../../services/question-answer/questionPaper.service";
import RegHelper from "../../utils/helper";
import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";
import httpStatus from "http-status";
import Session from "../../modals/Session.modal";
import Class from "../../modals/Class.modal";
import Subject from "../../modals/Subject.modal";
import fs from "fs";
import path from "path";

const getQuestionPaperErrorMessage = (error: any) => {
  if (error instanceof UniqueConstraintError) {
    const fields = Object.keys(error.fields || {});

    if (fields.includes("paperId")) {
      return "Question paper ID already exists";
    }

    if (
      fields.includes("paper_set") ||
      (error as any)?.constraint === "uq_question_paper_exam_paper_set"
    ) {
      return "A question paper with this Set already exists for the selected exam. Please choose a different Set.";
    }

    return error.errors?.[0]?.message || "Duplicate question paper data";
  }

  if (error instanceof ForeignKeyConstraintError) {
    return "Invalid institute, exam, or teacher selected";
  }

  if (error instanceof ValidationError) {
    return error.errors?.map((item) => item.message).join(", ") || error.message;
  }

  return error.message || "Something went wrong";
};

/** Tells the teacher what happened to the set's saved answers when the paper changed. */
const answerSheetNote = (summary: { relinked: number; unlinked: number } | null) => {
  if (!summary) return "";
  const parts: string[] = [];
  if (summary.relinked) parts.push(`${summary.relinked} saved answer(s) were linked to the matching questions`);
  if (summary.unlinked) {
    parts.push(
      `${summary.unlinked} saved answer(s) no longer match any question — open the answer sheet to link or discard them`
    );
  }
  return parts.length ? ` ${parts.join("; ")}.` : "";
};

export const createQuestionPaper = async (
  req: any,
  res: Response
) => {
  try {
    const {
      examId,
      teacherId,
      paperSet,
      content,
    } = req.body;

    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;

    if (
      !instituteId ||
      !examId ||
      !paperSet ||
      !content
    ) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (teacherId !== undefined && typeof teacherId !== "string") {
      return res.status(400).json({
        message: "teacherId must be a string",
      });
    }

    const { paper, answerSheet } = await QuestionPaperService.createQuestionPaper({
      instituteId,
      examId,
      teacherId,
      paperSet,
      content,
    });

    return res.status(201).json({
      message: `Question paper created successfully.${answerSheetNote(answerSheet)}`,
      data: {
        paperId: paper.paperId,
        examId: paper.examId,
        paperSet: paper.paperSet,
        status: paper.status,
        answerSheet,
      },
    });

  } catch (error: any) {
    return res.status(400).json({
      message: getQuestionPaperErrorMessage(error),
    });
  }
};

export const updateQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const { content, paperSet } = req.body;

    const { paper, answerSheet } = await QuestionPaperService.updateQuestionPaper(paperId, req.viaExamUser, {
      content,
      paperSet,
    });

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Question paper updated successfully.${answerSheetNote(answerSheet)}`,
      data: {
        paperId: paper.paperId,
        examId: paper.examId,
        paperSet: paper.paperSet,
        status: paper.status,
        answerSheet,
      },
    });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.BAD_REQUEST).json({
      error: true,
      message: getQuestionPaperErrorMessage(error),
    });
  }
};

export const deleteQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const result = await QuestionPaperService.deleteQuestionPaper(paperId, req.viaExamUser);

    return res.status(httpStatus.OK).json({
      error: false,
      message:
        result.deletedAnswerSheets > 0
          ? `Question paper and answer sheet for Set ${result.paperSet} deleted.`
          : `Question paper for Set ${result.paperSet} deleted.`,
      data: result,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.BAD_REQUEST).json({
      error: true,
      message: getQuestionPaperErrorMessage(error),
    });
  }
};

export const uploadImageController = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const files = req.files as {
      [fieldname: string]: Express.Multer.File[];
    };

    const toUploadUrl = (file: Express.Multer.File) =>
      `/${file.path.replace(/\\/g, "/").replace(/^uploads\//, "uploads/")}`;

    const diagramFiles = [
      ...(files?.diagram || []),
      ...(files?.diagramUrls || []),
    ];

    const diagramUrls = diagramFiles.map(toUploadUrl);

    const schoolLogo =
      files?.schoolLogo?.[0]
        ? toUploadUrl(files.schoolLogo[0])
        : null;

    return res.status(200).json({
      error: false,
      message: "Images uploaded successfully",
      data: {
        schoolLogo,
        diagramUrls,
      },
    });

  } catch (e: any) {
    return res.status(500).json({
      error: true,
      message: e.message,
    });
  }
};

export const getQuestionPaperBySelection = async (
  req: any,
  res: Response
): Promise<any> => {
  try {
    const {
      classVal,
      subject,
      examType,
      session,
      paperSet,
      examId,
    } = req.body;

    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;

    console.log("[getQuestionPaperBySelection] Request parameters:", {
      classVal,
      subject,
      examType,
      session,
      paperSet,
      examId,
      instituteId,
    });

    // 1. Direct lookup by examId if provided
    if (examId) {
      const qpWhere: any = { examId };
      if (paperSet) qpWhere.paperSet = paperSet;
      const directQp = await QuestionPaper.findOne({ where: qpWhere });
      if (directQp) {
        const examObj = await Exam.findOne({ where: { examId } });
        return res.status(httpStatus.OK).json({
          error: false,
          message: "Question paper fetched successfully.",
          data: {
            exam: examObj || { examId, examType, subjectName: subject, className: classVal },
            questionPaper: directQp,
          },
        });
      }
    }

    // 2. Lookup by session, class, subject, examType
    const cleanClass = (classVal || "").replace(/^class\s*/i, "").trim();
    const classWhere: any = { instituteId, isDeleted: false };

    const [sessionData, classData] = await Promise.all([
      Session.findOne({
        where: {
          sessionName: session,
          instituteId,
          isDeleted: false,
        },
      }),

      Class.findOne({
        where: {
          [Op.or]: [
            { className: classVal },
            { className: `Class ${cleanClass}` },
            { className: cleanClass },
          ],
          instituteId,
          isDeleted: false,
        },
      }),
    ]);

    if (!sessionData && session) {
      console.warn(`[getQuestionPaperBySelection] 404: Session '${session}' not found for institute '${instituteId}'`);
    }

    if (!classData) {
      console.warn(`[getQuestionPaperBySelection] 404: Class '${classVal}' not found for institute '${instituteId}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Class not found.",
      });
    }

    const subjectData = await Subject.findOne({
      where: {
        subjectName: subject,
        classId: classData.classId,
        instituteId,
        isDeleted: false,
      },
    });

    if (!subjectData) {
      console.warn(`[getQuestionPaperBySelection] 404: Subject '${subject}' not found for class '${classVal}' (classId: ${classData.classId})`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Subject not found.",
      });
    }

    const examWhere: any = {
      classId: classData.classId,
      subjectId: subjectData.subjectId,
      examType,
      instituteId,
      isDeleted: false,
    };
    if (sessionData) examWhere.sessionId = sessionData.sessionId;

    const exam = await Exam.findOne({ where: examWhere });

    if (!exam) {
      console.warn(`[getQuestionPaperBySelection] 404: Exam not found for session '${session}', class '${classVal}', subject '${subject}', examType '${examType}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Exam not found.",
      });
    }

    const qpWhere: any = { examId: exam.examId };
    if (paperSet) qpWhere.paperSet = paperSet;

    const questionPaper = await QuestionPaper.findOne({ where: qpWhere });

    if (!questionPaper) {
      console.warn(`[getQuestionPaperBySelection] 404: Question paper not found for examId '${exam.examId}', paperSet '${paperSet}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Question paper not found for selected exam.",
      });
    }

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Question paper fetched successfully.",
      data: {
        exam,
        questionPaper,
      },
    });

  } catch (error: any) {
    console.error("getQuestionPaperBySelection Error:", error);

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: `Something went wrong: ${error.message}`,
    });
  }
};

export const getQuestionPaperUploads = async (req: Request, res: Response) => {
  try {
    const baseDir = path.join(process.cwd(), "uploads", "question-papers");

    const listFiles = (dir: string, urlPath: string): string[] => {
      if (!fs.existsSync(dir)) return [];

      return fs
        .readdirSync(dir)
        .filter((file) => fs.statSync(path.join(dir, file)).isFile())
        .map((file) => `/uploads/question-papers/${urlPath}/${file}`);
    };

    return res.json({
      error: false,
      data: {
        diagrams: listFiles(path.join(baseDir, "diagrams"), "diagrams"),
        schoolLogos: listFiles(path.join(baseDir, "school-logos"), "school-logos"),
      },
    });

  } catch (e: any) {
    return res.status(500).json({
      error: true,
      message: e.message,
    });
  }
};

// ─── APPROVAL WORKFLOW CONTROLLERS ─────────────────────────────────────────

const sendWorkflowError = (res: Response, error: any) =>
  res.status(error?.statusCode || httpStatus.BAD_REQUEST).json({
    error: true,
    message: error.message,
  });

/** Optional set (A–D) for the exam-level approval endpoints: body `paperSet` or `?paperSet=`. */
const requestedSet = (req: any): string | undefined =>
  req.body?.paperSet || req.query?.paperSet || undefined;

export const submitExamForApproval = async (req: any, res: Response): Promise<any> => {
  try {
    const { examId } = req.params;
    const result = await QuestionPaperService.submitExamForApproval(examId, req.viaExamUser, requestedSet(req));

    const sets = result.submitted.map((s) => `Set ${s}`).join(", ");
    return res.status(httpStatus.OK).json({
      error: false,
      message: `${sets} submitted for approval.${
        result.skipped.length ? ` Skipped Set ${result.skipped.join(", ")} (answer sheet missing).` : ""
      }`,
      data: result,
    });
  } catch (error: any) {
    return sendWorkflowError(res, error);
  }
};

export const submitQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const paper = await QuestionPaperService.submitForApproval(paperId, req.viaExamUser);

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Set ${paper.paperSet} submitted for approval.`,
      data: paper,
    });
  } catch (error: any) {
    return sendWorkflowError(res, error);
  }
};

export const approveQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const paper = await QuestionPaperService.approvePaper(paperId, req.viaExamUser);

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Set ${paper.paperSet} approved.`,
      data: paper,
    });
  } catch (error: any) {
    return sendWorkflowError(res, error);
  }
};

export const rejectQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const { rejectionNote } = req.body;
    const paper = await QuestionPaperService.rejectPaper(paperId, req.viaExamUser, rejectionNote);

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Set ${paper.paperSet} rejected.`,
      data: paper,
    });
  } catch (error: any) {
    return sendWorkflowError(res, error);
  }
};

export const publishQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const paper = await QuestionPaperService.publishPaper(paperId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Question paper published.",
      data: paper,
    });
  } catch (error: any) {
    return sendWorkflowError(res, error);
  }
};

export const getPendingQuestionPapers = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;

    const papers = await QuestionPaperService.getPendingPapers(instituteId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Pending question papers fetched.",
      data: { papers },
    });
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: error.message,
    });
  }
};

export const getAllQuestionPapers = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const { status, examId, teacherId } = req.query;

    const papers = await QuestionPaperService.getPapers(instituteId, {
      status: status as string,
      examId: examId as string,
      teacherId: teacherId as string,
    });

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Question papers fetched.",
      data: { papers },
    });
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: error.message,
    });
  }
};

export const approveExamPair = async (req: any, res: Response): Promise<any> => {
  try {
    const { examId } = req.params;
    const result = await QuestionPaperService.approveExamPair(examId, req.viaExamUser, requestedSet(req));

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Set ${result.approved.join(", ")} approved (question paper and answer sheet).`,
      data: result,
    });
  } catch (error: any) {
    return sendWorkflowError(res, error);
  }
};

export const rejectExamPair = async (req: any, res: Response): Promise<any> => {
  try {
    const { examId } = req.params;
    const { rejectionNote } = req.body;
    const result = await QuestionPaperService.rejectExamPair(examId, req.viaExamUser, rejectionNote, requestedSet(req));

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Set ${result.rejected.join(", ")} rejected.`,
      data: result,
    });
  } catch (error: any) {
    return sendWorkflowError(res, error);
  }
};

// ─── REMARKS / CHAT CONTROLLERS ─────────────────────────────────────────

export const getExamRemarksController = async (req: any, res: Response): Promise<any> => {
  try {
    const { examId } = req.params;

    const result = await QuestionPaperService.getExamRemarks(examId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Remarks fetched successfully.",
      data: result,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const addExamRemarkController = async (req: any, res: Response): Promise<any> => {
  try {
    const { examId } = req.params;
    const { remark } = req.body;
    const user = req.viaExamUser || req.user || {};
    const rawRole = (typeof user.role === "object" ? user.role?.role : user.role || "ADMIN").toString().toUpperCase();
    const senderRole = rawRole.includes("TEACH") ? "TEACHER" : "ADMIN";
    const senderName = user.name || user.fullName || (senderRole === "TEACHER" ? "Teacher" : "Admin Reviewer");

    const result = await QuestionPaperService.addExamRemark(examId, remark, senderRole, senderName);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Remark added successfully.",
      data: result,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};
