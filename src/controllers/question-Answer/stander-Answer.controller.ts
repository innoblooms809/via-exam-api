import { Request, Response } from "express";
import QuestionPaperAnswerService from "../../services/question-answer/stander-answer.service";
import Session from "../../modals/Session.modal";
import Class from "../../modals/Class.modal";
import Subject from "../../modals/Subject.modal";
import Exam from "../../modals/Exam.modal";
import QuestionPaperAnswer from "../../modals/question-paper/stander-answer.model";
import httpStatus from "http-status";
import cloudinary from "../../utils/cloudinary";
import fs from "fs";
import path from "path";

export const createQuestionPaperAnswer = async (
  req: any,
  res: Response
): Promise<any> => {
  try {
    const {
      paperId,
      examId,
      teacherId,
      paperSet,
      answers,
      status,
    } = req.body;

    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;

    if (
      !instituteId ||
      !paperId ||
      !examId ||
      !teacherId ||
      !paperSet ||
      !answers
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const result =
      await QuestionPaperAnswerService.createQuestionPaperAnswer(
        {
          instituteId,
          paperId,
          examId,
          teacherId,
          paperSet,
          answers,
          status,
        }
      );

    return res.status(201).json({
      success: true,
      message: "Question paper answer created successfully",
      data: result,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const uploadFileToCloudinary = (file: Express.Multer.File) =>
  new Promise<string>((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: "answer-sheets",
        resource_type: "auto",
        public_id: `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      },
      (error: any, result: any) => {
        if (error) {
          reject(error);
        } else {
          resolve(result?.secure_url || "");
        }
      }
    );
    uploadStream.end(file.buffer);
  });

export const uploadImageController = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const files = req.files as {
      [fieldname: string]: Express.Multer.File[];
    };

    const diagramFiles = [
      ...(files?.diagram || []),
      ...(files?.diagramUrls || []),
    ];

    const diagramUrls: string[] = [];

    for (const file of diagramFiles) {
      try {
        const url = await uploadFileToCloudinary(file);
        if (url) diagramUrls.push(url);
      } catch (e: any) {
        console.error(`Cloudinary upload failed for ${file.originalname}:`, e.message);
      }
    }

    return res.status(200).json({
      error: false,
      message: "Images uploaded successfully",
      data: {
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

export const uploadPdfController = async (
  req: any,
  res: Response
): Promise<any> => {
  try {
    const files: Express.Multer.File[] = Array.isArray(req.files)
      ? (req.files as Express.Multer.File[])
      : req.file
        ? [req.file as Express.Multer.File]
        : [];

    const urls: string[] = [];

    for (const file of files) {
      try {
        const url = await uploadFileToCloudinary(file);
        if (url) urls.push(url);
      } catch (e: any) {
        console.error(`Cloudinary upload failed for ${file.originalname}:`, e.message);
      }
    }

    if (urls.length === 0) {
      return res.status(400).json({
        error: true,
        message: "No files uploaded successfully.",
        data: { urls },
      });
    }

    const { paperId, examId, paperSet } = req.body;
    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;
    const teacherId = req.viaExamUser?.userId || req.body.teacherId;

    let dbResult = null;
    if (paperId && examId && paperSet && instituteId && teacherId) {
      try {
        dbResult = await QuestionPaperAnswerService.saveAnswerSheetPdfUrl({
          paperId,
          examId,
          paperSet,
          instituteId,
          teacherId,
          pdfUrl: urls[0],
        });
      } catch (dbErr: any) {
        console.error("Failed to save answer sheet PDF url to database:", dbErr.message);
      }
    }

    return res.status(200).json({
      error: false,
      message: "Answer sheet uploaded successfully",
      data: {
        urls,
        url: urls[0],
        questionPaperAnswer: dbResult,
      },
    });
  } catch (e: any) {
    return res.status(500).json({
      error: true,
      message: e.message,
    });
  }
};

export const getQuestionPaperAnswerBySelection = async (
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

    console.log("[getQuestionPaperAnswerBySelection] Request parameters:", {
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
      console.warn(`[getQuestionPaperAnswerBySelection] 404: Session '${session}' not found for institute '${instituteId}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Session not found.",
      });
    }

    if (!classData) {
      console.warn(`[getQuestionPaperAnswerBySelection] 404: Class '${classVal}' not found for institute '${instituteId}'`);
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
      console.warn(`[getQuestionPaperAnswerBySelection] 404: Subject '${subject}' not found for class '${classVal}' (classId: ${classData.classId})`);
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
      console.warn(`[getQuestionPaperAnswerBySelection] 404: Exam not found for session '${session}', class '${classVal}', subject '${subject}', examType '${examType}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Exam not found.",
      });
    }

    const questionPaperAnswer = await QuestionPaperAnswer.findOne({
      where: {
        examId: exam.examId,
        paperSet,
      },
    });

    if (!questionPaperAnswer) {
      console.warn(`[getQuestionPaperAnswerBySelection] 404: Question paper answer not found for examId '${exam.examId}', paperSet '${paperSet}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Question paper answer not found for selected exam.",
      });
    }

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Question paper answer fetched successfully.",
      data: {
        exam,
        questionPaperAnswer,
      },
    });

  } catch (error: any) {
    console.error("getQuestionPaperAnswerBySelection Error:", error);

    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: `Something went wrong: ${error.message}`,
    });
  }
};

export const getQuestionPaperAnswerUploads = async (req: Request, res: Response) => {
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

export const submitAnswerSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;
    const teacherId = req.viaExamUser.userId;

    const answer = await QuestionPaperAnswerService.submitForApproval(answerId, teacherId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Answer sheet submitted for approval.",
      data: answer,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const approveAnswerSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;
    const reviewerId = req.viaExamUser.userId;

    const answer = await QuestionPaperAnswerService.approveAnswer(answerId, reviewerId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Answer sheet approved.",
      data: answer,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const rejectAnswerSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;
    const reviewerId = req.viaExamUser.userId;
    const { rejectionNote } = req.body;

    const answer = await QuestionPaperAnswerService.rejectAnswer(answerId, reviewerId, rejectionNote);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Answer sheet rejected.",
      data: answer,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const publishAnswerSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;

    const answer = await QuestionPaperAnswerService.publishAnswer(answerId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Answer sheet published.",
      data: answer,
    });
  } catch (error: any) {
    return res.status(httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const getPendingAnswerSheets = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;

    const answers = await QuestionPaperAnswerService.getPendingAnswers(instituteId);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Pending answer sheets fetched.",
      data: { answers },
    });
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: error.message,
    });
  }
};

export const getAllAnswerSheets = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const { status, examId, teacherId } = req.query;

    const answers = await QuestionPaperAnswerService.getAnswers(instituteId, {
      status: status as string,
      examId: examId as string,
      teacherId: teacherId as string,
    });

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Answer sheets fetched.",
      data: { answers },
    });
  } catch (error: any) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      message: error.message,
    });
  }
};
