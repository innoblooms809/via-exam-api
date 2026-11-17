import { Response } from "express";
import { Op } from "sequelize";
import QuestionPaperAnswerService from "../../services/question-paper/standardAnswer.service";
import { QuestionPaperService, listsEveryPaper } from "../../services/question-paper/questionPaper.service";
import Session from "../../models/Session.model";
import Class from "../../models/Class.model";
import Subject from "../../models/Subject.model";
import Exam from "../../models/Exam.model";
import QuestionPaperAnswer from "../../models/question-paper/StandardAnswer.model";
import httpStatus from "http-status";
import { warmAnswerKeyOcr } from "../../services/evaluation/pipeline6.service";
import path from "path";
import { randomUUID } from "crypto";
import {
  MODEL_ANSWERS_ROOT,
  localPathOf,
  removeStoredFile,
  safeSegment,
  webPathOf,
  writeStoredFile,
} from "../../utils/localFileStorage";

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
        },
        req.viaExamUser
      );

    return res.status(201).json({
      success: true,
      message: "Question paper answer created successfully",
      data: result,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
};

// Extension of each type verifyUploads accepts on these routes (it sets `mimetype` from the bytes).
const MODEL_ANSWER_EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/**
 * Stores a model answer file (the answer PDF or a diagram) under
 * uploads/private/model-answers/<institute>/ with a server-chosen name. Only signed-in admins and
 * teachers of that institute can open it (middlewares/uploadsAccess.ts). Returns its web path.
 */
export const storeModelAnswerFile = async (file: Express.Multer.File, instituteId: string): Promise<string> => {
  const name = `${safeSegment(file.fieldname, "file")}-${randomUUID()}${MODEL_ANSWER_EXTENSIONS[file.mimetype] ?? ""}`;
  const stored = await writeStoredFile(path.join(MODEL_ANSWERS_ROOT, safeSegment(instituteId)), name, file.buffer);
  return webPathOf(stored);
};

/** Removes files this request stored (a failed upload must not leave them behind). */
const removeModelAnswerFiles = (urls: string[]) =>
  Promise.all(urls.map((url) => removeStoredFile(localPathOf(url), MODEL_ANSWERS_ROOT, "failed upload")));

export const uploadImageController = async (
  req: any,
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

    const instituteId = req.viaExamUser?.instituteId;
    if (diagramFiles.length && !instituteId) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: true, message: "Institute not found for this user." });
    }

    const diagramUrls: string[] = [];
    try {
      for (const file of diagramFiles) diagramUrls.push(await storeModelAnswerFile(file, instituteId));
    } catch (e: any) {
      console.error("Storing model answer images failed:", e.message);
      await removeModelAnswerFiles(diagramUrls);
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        error: true,
        message: "The images could not be saved. Please try again.",
      });
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

    const { paperId, examId, paperSet } = req.body;
    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;
    let teacherId = req.viaExamUser?.userId || req.body.teacherId;
    const linkToPaper = Boolean(paperId && examId && paperSet && instituteId && teacherId);

    if (linkToPaper) {
      // The paper must be in this institute, of this exam and set, and (for a teacher) their own.
      const paper = await QuestionPaperService.findPaperForUser(paperId, req.viaExamUser);
      if (paper.examId !== examId || paper.paperSet !== String(paperSet).toUpperCase()) {
        return res.status(httpStatus.BAD_REQUEST).json({ error: true, message: "This question paper belongs to a different exam or set." });
      }
      teacherId = paper.teacherId;
      // Refuse before uploading if this set's answer sheet is already under review/approved.
      await QuestionPaperAnswerService.assertReplaceable(paperId, paperSet, examId);
    }

    const urls: string[] = [];

    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        return res.status(httpStatus.BAD_REQUEST).json({
          error: true,
          message: `File "${file.originalname}" exceeds the maximum allowed size limit of 10 MB.`,
        });
      }
    }

    // Stored under the signed-in user's own institute, never one named in the request.
    const storeIn = req.viaExamUser?.instituteId;
    if (files.length && !storeIn) {
      return res.status(httpStatus.BAD_REQUEST).json({ error: true, message: "Institute not found for this user." });
    }
    try {
      for (const file of files) urls.push(await storeModelAnswerFile(file, storeIn));
    } catch (e: any) {
      console.error("Storing the model answer file failed:", e.message);
      await removeModelAnswerFiles(urls);
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        error: true,
        message: "The file could not be saved. Please try again.",
      });
    }

    if (urls.length === 0) {
      return res.status(400).json({
        error: true,
        message: "No files uploaded successfully.",
        data: { urls },
      });
    }

    let dbResult = null;
    if (linkToPaper) {
      try {
        dbResult = await QuestionPaperAnswerService.saveAnswerSheetPdfUrl({
          paperId,
          examId,
          paperSet,
          instituteId,
          teacherId,
          pdfUrl: urls[0],
        });
        // Read the uploaded model answer by OCR once, in the background, and save the
        // text — AI evaluation then reuses it for every student instead of re-reading it.
        if (dbResult?.answerId) warmAnswerKeyOcr(dbResult.answerId);
      } catch (dbErr: any) {
        console.error("Failed to save answer sheet PDF url to database:", dbErr.message);
        // The file was stored but is not linked to the paper: remove it and report a failure.
        await removeModelAnswerFiles(urls);
        return res.status(dbErr?.statusCode || httpStatus.BAD_REQUEST).json({
          error: true,
          message: dbErr.message || "Answer sheet uploaded but could not be saved. Please try again.",
        });
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
    return res.status(e?.statusCode || 500).json({
      error: true,
      message: e.message,
    });
  }
};

export const updateQuestionPaperAnswer = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;
    const answer = await QuestionPaperAnswerService.updateQuestionPaperAnswer(
      answerId,
      req.viaExamUser,
      req.body?.answers
    );

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Answer sheet updated successfully",
      data: answer,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const deleteQuestionPaperAnswer = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;
    const result = await QuestionPaperAnswerService.deleteQuestionPaperAnswer(answerId, req.viaExamUser);

    return res.status(httpStatus.OK).json({
      error: false,
      message: "Answer sheet deleted successfully",
      data: result,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
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
      examId,
    } = req.body;

    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;

    console.log("[getQuestionPaperAnswerBySelection] Request parameters:", {
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
      // The requester's school only: an exam id from another school finds nothing.
      const qpaWhere: any = { examId, ...(instituteId ? { instituteId } : {}) };
      if (paperSet) qpaWhere.paperSet = paperSet;
      const directQpa = await QuestionPaperAnswer.findOne({ where: qpaWhere });
      if (directQpa) {
        const examObj = await Exam.findOne({ where: { examId, instituteId: directQpa.instituteId } });
        return res.status(httpStatus.OK).json({
          error: false,
          message: "Question paper answer fetched successfully.",
          data: {
            exam: examObj || { examId, examType, subjectName: subject, className: classVal },
            questionPaperAnswer: directQpa,
          },
        });
      }
    }

    // 2. Lookup by session, class, subject, examType
    const cleanClass = (classVal || "").replace(/^class\s*/i, "").trim();

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
      console.warn(`[getQuestionPaperAnswerBySelection] 404: Session '${session}' not found for institute '${instituteId}'`);
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
      console.warn(`[getQuestionPaperAnswerBySelection] 404: Exam not found for session '${session}', class '${classVal}', subject '${subject}', examType '${examType}'`);
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Exam not found.",
      });
    }

    const qpaWhere: any = { examId: exam.examId };
    if (paperSet) qpaWhere.paperSet = paperSet;

    const questionPaperAnswer = await QuestionPaperAnswer.findOne({ where: qpaWhere });

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

export const approveAnswerSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;
    const answer = await QuestionPaperAnswerService.approveAnswer(answerId, req.viaExamUser);

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Set ${answer.paperSet} approved.`,
      data: answer,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const rejectAnswerSheet = async (req: any, res: Response): Promise<any> => {
  try {
    const { answerId } = req.params;
    const { rejectionNote } = req.body;

    const answer = await QuestionPaperAnswerService.rejectAnswer(answerId, req.viaExamUser, rejectionNote);

    return res.status(httpStatus.OK).json({
      error: false,
      message: `Set ${answer.paperSet} rejected.`,
      data: answer,
    });
  } catch (error: any) {
    return res.status(error?.statusCode || httpStatus.BAD_REQUEST).json({
      error: true,
      message: error.message,
    });
  }
};

export const getAllAnswerSheets = async (req: any, res: Response): Promise<any> => {
  try {
    const instituteId = req.viaExamUser.instituteId;
    const { status, examId, teacherId, sessionId, summary } = req.query;

    const answers = await QuestionPaperAnswerService.getAnswers(instituteId, {
      status: status as string,
      examId: examId as string,
      // A teacher lists only their own answer sheets; the school's admins list every one.
      teacherId: listsEveryPaper(req.viaExamUser) ? (teacherId as string) : String(req.viaExamUser.userId ?? "-"),
      sessionId: sessionId as string,
      // ?summary=1: the sheets' state without the answers themselves (the list of every sheet).
      summary: ["1", "true"].includes(String(summary ?? "").toLowerCase()),
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
