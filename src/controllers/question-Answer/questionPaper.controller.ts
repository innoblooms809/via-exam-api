import { Request, Response } from "express";
import {
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

    await QuestionPaperService.createQuestionPaper({
      instituteId,
      examId,
      teacherId,
      paperSet,
      content,
    });

    return res.status(201).json({
      message: "Question paper created successfully",
    });

  } catch (error: any) {
    return res.status(400).json({
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
    } = req.body;

    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;

    console.log("[getQuestionPaperBySelection] Request parameters:", {
      classVal,
      subject,
      examType,
      session,
      paperSet,
      instituteId,
    });

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
          className: classVal,
          instituteId,
          isDeleted: false,
        },
      }),
    ]);

    if (!sessionData) {
      console.warn(`[getQuestionPaperBySelection] 404: Session '${session}' not found for institute '${instituteId}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Session not found.",
      });
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

    const exam = await Exam.findOne({
      where: {
        sessionId: sessionData.sessionId,
        classId: classData.classId,
        subjectId: subjectData.subjectId,
        examType,
        instituteId,
        isDeleted: false,
      },
    });

    if (!exam) {
      console.warn(`[getQuestionPaperBySelection] 404: Exam not found for session '${session}', class '${classVal}', subject '${subject}', examType '${examType}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Exam not found.",
      });
    }

    const questionPaper = await QuestionPaper.findOne({
      where: {
        examId: exam.examId,
        paperSet,
      },
    });

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

export const submitQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const teacherId = req.viaExamUser.userId;

    const paper = await QuestionPaperService.submitForApproval(paperId, teacherId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Question paper submitted for approval.",
      data: paper,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const approveQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const reviewerId = req.viaExamUser.userId;

    const paper = await QuestionPaperService.approvePaper(paperId, reviewerId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Question paper approved.",
      data: paper,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const rejectQuestionPaper = async (req: any, res: Response): Promise<any> => {
  try {
    const { paperId } = req.params;
    const reviewerId = req.viaExamUser.userId;
    const { rejectionNote } = req.body;

    const paper = await QuestionPaperService.rejectPaper(paperId, reviewerId, rejectionNote);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Question paper rejected.",
      data: paper,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
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
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
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
