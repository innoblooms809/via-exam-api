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
import { QuestionPaperService } from "../services/questionPaper.service";

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
    console.log(req.body)

    // ─────────────────────────────────────────────
    // 1. Basic validation
    // ─────────────────────────────────────────────

    if (
      !instituteId ||
      !examId ||
      !teacherId ||
      !paperSet ||
      !content
    ) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    // ─────────────────────────────────────────────
    // 2. Call service
    // ─────────────────────────────────────────────

    const paper =
      await QuestionPaperService.createQuestionPaper({
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
      data: paper,
    });

  } catch (error: any) {
    return res.status(400).json({
      message: error.message || "Something went wrong",
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

