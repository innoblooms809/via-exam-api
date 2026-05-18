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
import { QuestionPaperService } from "../../services/question-answer/questionPaper.service";
import RegHelper from "../../utils/helper";
import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";
import httpStatus from "http-status";
import Session from "../../modals/Session.modal";
import Class from "../../modals/Class.modal";
import Subject from "../../modals/Subject.modal";

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

    // if (paperId !== undefined && typeof paperId !== "string") {
    //   return res.status(400).json({
    //     message: "paperId must be a string",
    //   });
    // }

    // ─────────────────────────────────────────────
    // 2. Call service
    // ─────────────────────────────────────────────
  
   
      await QuestionPaperService.createQuestionPaper({
        paperId:"313d",
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
      // data: paperId,
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



// export const getQuestionPaperBySelection = async (
//   req: Request,
//   res: Response
// ): Promise<any> => {
//   try {
//     const {
//       classVal,
//       subject,
//       examType,
//       teacherId,
//       instituteId,
//       session,
//       paperSet,
//     } = req.body;
//     console.log("Received getQuestionPaperBySelection request with body:", req.body);

//     // ─────────────────────────────────────────────
//     // SINGLE QUERY (ALL JOINS)
//     // ─────────────────────────────────────────────

//     const examWithPaper = await Exam.findOne({
//       where: {
//         examType,
//         teacherId,
//         instituteId,
//         isDeleted: false,
//       },

//       include: [
//         {
//           model: Session,
//           as: "session",
//           where: {
//             sessionName: session,
//             instituteId,
//             isDeleted: false,
//           },
//         },
//         {
//           model: Class,
//           as: "class",
//           where: {
//             className: classVal,
//             instituteId,
//             isDeleted: false,
//           },
//         },
//         {
//           model: Subject,
//           as: "subject",
//           where: {
//             subjectName: subject,
//             instituteId,
//             isDeleted: false,
//           },
//         },
//         {
//           model: QuestionPaper,
//           as: "questionPapers",
//           required: false,
//           where: {
//             paperSet,
//           },
//         },
//       ],
//     });
//     console.log("Exam with Paper:", examWithPaper)

//     // ─────────────────────────────────────────────
//     // NOT FOUND
//     // ─────────────────────────────────────────────

//     if (!examWithPaper) {
//       return res.status(httpStatus.NOT_FOUND).json({
//         error: true,
//         message: "Exam or related data not found",
//       });
//     }

//     // ─────────────────────────────────────────────
//     // QUESTION PAPER CHECK
//     // ─────────────────────────────────────────────

//     const questionPaper = examWithPaper.questionPapers;

//     if (!questionPaper) {
//       return res.status(httpStatus.NOT_FOUND).json({
//         error: true,
//         message: "Question paper not found for selected exam",
//       });
//     }

//     // ─────────────────────────────────────────────
//     // SUCCESS
//     // ─────────────────────────────────────────────

//     return res.status(httpStatus.OK).json({
//       error: false,
//       message: "Question paper fetched successfully",
//       data: examWithPaper,
//     });

//   } catch (error: any) {
//     console.error("getQuestionPaperBySelection Error:", error);

//     return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
//       error: true,
//       message: error.message,
//     });
//   }
// };


export const getQuestionPaperBySelection = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const {
      classVal,
      subject,
      examType,
      teacherId,
      instituteId,
      session,
      paperSet,
    } = req.body;

    // ─────────────────────────────────────────────
    // FIND SESSION + CLASS
    // ─────────────────────────────────────────────

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
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Session not found.",
      });
    }

    if (!classData) {
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Class not found.",
      });
    }

    // ─────────────────────────────────────────────
    // FIND SUBJECT
    // ─────────────────────────────────────────────

    const subjectData = await Subject.findOne({
      where: {
        subjectName: subject,
        classId: classData.classId,
        instituteId,
        isDeleted: false,
      },
    });

    if (!subjectData) {
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Subject not found.",
      });
    }

    // ─────────────────────────────────────────────
    // FIND EXAM
    // ─────────────────────────────────────────────

    const exam = await Exam.findOne({
      where: {
        sessionId: sessionData.sessionId,
        classId: classData.classId,
        subjectId: subjectData.subjectId,
        examType,
        teacherId,
        instituteId,
        isDeleted: false,
      },
    });

    if (!exam) {
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Exam not found.",
      });
    }

    // ─────────────────────────────────────────────
    // FIND QUESTION PAPER
    // ─────────────────────────────────────────────

    const questionPaper = await QuestionPaper.findOne({
      where: {
        examId: exam.examId,
        paperSet,
      },
    });

    if (!questionPaper) {
      return res.status(httpStatus.NOT_FOUND).json({
        error: true,
        message: "Question paper not found for selected exam.",
      });
    }

    // ─────────────────────────────────────────────
    // SUCCESS
    // ─────────────────────────────────────────────

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