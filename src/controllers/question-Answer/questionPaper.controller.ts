// import httpStatus from "http-status";
// import { Request, Response } from "express";
// import QuestionPaperService from "../services/questionPaper.service";

// // ═════════════════════════════════════════════════════════════════
// // 1. POST /v1/question-papers
// //    Teacher saves a question paper as Draft
// // ═════════════════════════════════════════════════════════════════

// const saveDraft = async (req: any, res: Response): Promise<any> => {
//   try {
//     const { userId, instituteId } = req.user;
//     const { examId, content }     = req.body;

//     if (!examId || !content) {
//       return res.status(httpStatus.BAD_REQUEST).json({
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "examId and content are required.",
//       });
//     }

//     const result = await QuestionPaperService.saveDraft(userId, instituteId, {
//       examId,
//       content,
//     });

//     return res.status(result.statusCode).send(result);
//   } catch (error) {
//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: "Internal Server Error",
//     });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// // 2. PATCH /v1/question-papers/:paperId/submit
// //    Teacher submits paper for examiner review
// // ═════════════════════════════════════════════════════════════════

// const submitPaper = async (req: any, res: Response): Promise<any> => {
//   try {
//     const { userId, instituteId } = req.user;
//     const { paperId }             = req.params;

//     const result = await QuestionPaperService.submitPaper(
//       userId,
//       instituteId,
//       paperId
//     );

//     return res.status(result.statusCode).send(result);
//   } catch (error) {
//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: "Internal Server Error",
//     });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// // 3. GET /v1/question-papers/teacher/my-exams
// //    Teacher views all assigned exams + paper status
// // ═════════════════════════════════════════════════════════════════

// const getMyExams = async (req: any, res: Response): Promise<any> => {
//   try {
//     const { userId, instituteId } = req.user;

//     const result = await QuestionPaperService.getMyExams(
//       userId,
//       instituteId,
//       req.query
//     );

//     return res.status(result.statusCode).send(result);
//   } catch (error) {
//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: "Internal Server Error",
//     });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// // 4. GET /v1/question-papers/submitted
// //    Examiner views all submitted papers pending review
// // ═════════════════════════════════════════════════════════════════

// const getSubmittedPapers = async (req: any, res: Response): Promise<any> => {
//   try {
//     const { instituteId } = req.user;

//     const result = await QuestionPaperService.getSubmittedPapers(
//       instituteId,
//       req.query
//     );

//     return res.status(result.statusCode).send(result);
//   } catch (error) {
//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: "Internal Server Error",
//     });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// // 5. PATCH /v1/question-papers/:paperId/approve
// //    Examiner approves → paper = Approved, exam = Live
// // ═════════════════════════════════════════════════════════════════

// const approvePaper = async (req: any, res: Response): Promise<any> => {
//   try {
//     const { instituteId } = req.user;
//     const { paperId }     = req.params;

//     const result = await QuestionPaperService.approvePaper(
//       instituteId,
//       paperId
//     );

//     return res.status(result.statusCode).send(result);
//   } catch (error) {
//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: "Internal Server Error",
//     });
//   }
// };

// // ═════════════════════════════════════════════════════════════════
// // 6. PATCH /v1/question-papers/:paperId/reject
// //    Examiner rejects → paper = Rejected, exam = Draft
// // ═════════════════════════════════════════════════════════════════

// const rejectPaper = async (req: any, res: Response): Promise<any> => {
//   try {
//     const { instituteId }   = req.user;
//     const { paperId }       = req.params;
//     const { rejectionNote } = req.body;

//     if (!rejectionNote?.trim()) {
//       return res.status(httpStatus.BAD_REQUEST).json({
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "rejectionNote is required.",
//       });
//     }

//     const result = await QuestionPaperService.rejectPaper(
//       instituteId,
//       paperId,
//       rejectionNote
//     );

//     return res.status(result.statusCode).send(result);
//   } catch (error) {
//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: "Internal Server Error",
//     });
//   }
// };

// // ─────────────────────────────────────────────────────────────────
// export default {
//   saveDraft,
//   submitPaper,
//   getMyExams,
//   getSubmittedPapers,
//   approvePaper,
//   rejectPaper,
// };


import { Request, Response } from "express";
import {
  ForeignKeyConstraintError,
  UniqueConstraintError,
  ValidationError,
} from "sequelize";
import { QuestionPaperService } from "../../services/questionPaper.service";
import RegHelper from "../../utils/helper";
import QuestionPaper from "../../modals/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";

const getQuestionPaperErrorMessage = (error: any) => {
  if (error instanceof UniqueConstraintError) {
    const fields = Object.keys(error.fields || {});
    if (fields.includes("paperId")) {
      return "Question paper ID already exists";
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
  req: Request,
  res: Response
) => {
  try {
    const {
      paperId,
      instituteId,
      examId,
      teacherId,
      paperSet,
      content,
    } = req.body;
    

    // ─────────────────────────────────────────────
    // 1. Basic validation
    // ─────────────────────────────────────────────

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

    if (paperId !== undefined && typeof paperId !== "string") {
      return res.status(400).json({
        message: "paperId must be a string",
      });
    }

    // ─────────────────────────────────────────────
    // 2. Call service
    // ─────────────────────────────────────────────

   
      await QuestionPaperService.createQuestionPaper({
        paperId,
        instituteId,
        examId,
        teacherId,
        paperSet,
        content,
      });

    // ─────────────────────────────────────────────
    // 3. Response
    // ─────────────────────────────────────────────
    return res.status(201).json({
      message: "Question paper created successfully",
      data: paperId,
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


//
// ─────────────────────────────────────────────────────────────────
export const getQuestionPaperBySet = async (
  req: Request,
  res: Response
): Promise<any> => {

  try {

     const examId = String(req.query.examId);
    const paperSet = String(req.query.paperSet);


    if (!examId || !paperSet) {

      return res.status(400).json({
        error: true,
        message:
          "examId and paperSet are required",
      });

    }

    const paper =
      await QuestionPaper.findOne({
        where: {
          examId,
          paperSet,
        },

        include: [
          {
            model: Exam,
            as: "exam",
          },
        ],
      });

    if (!paper) {

      return res.status(404).json({
        error: true,
        message:
          "Question paper not found",
      });

    }

    return res.status(200).json({
      error: false,
      message:
        "Question paper fetched successfully",
      data: paper,
    });

  } catch (e: any) {

    return res.status(500).json({
      error: true,
      message: e.message,
    });

  }
};







// ─────────────────────────────────────────────────────────────────

export const getQuestionPaperSets = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {

   

    const classVal = String(req.query.classVal);
const subject = String(req.query.subject);
const session = String(req.query.session);
const examType = String(req.query.examType);


    const exam = await Exam.findOne({
      where: {
        classVal,
        subject,
        session,
        examType,
        isDeleted: false,
      },
    });

    if (!exam) {
      return res.status(404).json({
        error: true,
        message: "Exam not found",
      });
    }

    const papers = await QuestionPaper.findAll({
      where: {
        examId: exam.examId,
      },

      attributes: [
        "paperSet",
        "status",
      ],
    });

    return res.status(200).json({
      error: false,

      message:
        "Question paper sets fetched successfully",

      data: {
        examId: exam.examId,

        subject: exam.subject,

        classVal: exam.classVal,

        session: exam.session,

        examType: exam.examType,

        availableSets: papers.map(
          (item) => item.paperSet
        ),

        papers,
      },
    });

  } catch (e: any) {

    return res.status(500).json({
      error: true,
      message: e.message,
    });

  }
};