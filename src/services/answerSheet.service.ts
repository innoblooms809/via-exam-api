// import httpStatus from "http-status";
// import AnswerSheet from "../modals/AnswerSheet.modal";
// import QuestionPaper from "../modals/QuestionPaper.modal";
// import Exam from "../modals/Exam.modal";
// import RegHelper from "../utils/helper";

// // ─── TEACHER: Save answer sheet as draft ──────────────────────────────────────
// const saveAnswerSheet = async (body: any, teacher: any): Promise<any> => {
//   try {
//     // 1. Check question paper exists and belongs to teacher
//     const paper = await QuestionPaper.findOne({
//       where: {
//         paperId:   body.paperId,
//         teacherId: teacher.userId,
//         isDeleted: false,
//       },
//     });

//     if (!paper) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Question paper not found or not assigned to you.",
//       };
//     }

//     // 2. Question paper must be approved before answer sheet
//     if (paper.status !== "Approved") {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "Question paper must be approved before creating answer sheet.",
//       };
//     }

//     // 3. Check if answer sheet already exists
//     const existing = await AnswerSheet.findOne({
//       where: {
//         paperId:   body.paperId,
//         teacherId: teacher.userId,
//         isDeleted: false,
//       },
//     });

//     if (existing) {
//       // Update existing draft
//       await existing.update({
//         answers: body.answers,
//         status:  "Draft",
//       });

//       return {
//         error: false,
//         statusCode: httpStatus.OK,
//         message: "Answer sheet saved as draft.",
//         data: existing,
//       };
//     }

//     // 4. Create new answer sheet
//     const answerSheetId = await RegHelper.generateUserId();

//     const answerSheet = await AnswerSheet.create({
//       answerSheetId,
//       examId:      paper.examId,
//       paperId:     body.paperId,
//       teacherId:   teacher.userId,
//       instituteId: teacher.instituteId,
//       answers:     body.answers,
//       status:      "Draft",
//     });

//     return {
//       error: false,
//       statusCode: httpStatus.CREATED,
//       message: "Answer sheet saved as draft.",
//       data: answerSheet,
//     };
//   } catch (e: any) {
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// // ─── TEACHER: Submit answer sheet ─────────────────────────────────────────────
// const submitAnswerSheet = async (
//   answerSheetId: string,
//   teacher: any
// ): Promise<any> => {
//   try {
//     const sheet = await AnswerSheet.findOne({
//       where: {
//         answerSheetId,
//         teacherId: teacher.userId,
//         isDeleted: false,
//       },
//     });

//     if (!sheet) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Answer sheet not found.",
//       };
//     }

//     if (sheet.status === "Approved") {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "Answer sheet is already approved.",
//       };
//     }

//     // Check all questions have answers
//     const emptyAnswers = (sheet.answers as any[]).filter(
//       (a) => !a.answer?.trim()
//     );

//     if (emptyAnswers.length > 0) {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: `${emptyAnswers.length} question(s) have no answer. Please fill all answers before submitting.`,
//       };
//     }

//     await sheet.update({
//       status:        "Submitted",
//       submittedAt:   new Date(),
//       rejectionNote: null,
//     });

//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Answer sheet submitted for review.",
//       data: sheet,
//     };
//   } catch (e: any) {
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// // ─── TEACHER: Get my answer sheet for a paper ─────────────────────────────────
// const getMyAnswerSheet = async (
//   paperId: string,
//   teacher: any
// ): Promise<any> => {
//   try {
//     const sheet = await AnswerSheet.findOne({
//       where: {
//         paperId,
//         teacherId: teacher.userId,
//         isDeleted: false,
//       },
//     });

//     if (!sheet) {
//       return {
//         error: false,
//         statusCode: httpStatus.OK,
//         message: "No answer sheet found.",
//         data: null,
//       };
//     }

//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Answer sheet fetched.",
//       data: sheet,
//     };
//   } catch (e: any) {
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// // ─── EXAMINER: Get all submitted answer sheets ────────────────────────────────
// const getSubmittedAnswerSheets = async (
//   requestedBy: any
// ): Promise<any> => {
//   try {
//     const sheets = await AnswerSheet.findAll({
//       where: {
//         instituteId: requestedBy.instituteId,
//         status:      "Submitted",
//         isDeleted:   false,
//       },
//       order: [["submittedAt", "ASC"]],
//     });

//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Submitted answer sheets fetched.",
//       data: { sheets, total: sheets.length },
//     };
//   } catch (e: any) {
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// // ─── EXAMINER: Get one answer sheet ──────────────────────────────────────────
// const getAnswerSheetById = async (
//   answerSheetId: string,
//   requestedBy: any
// ): Promise<any> => {
//   try {
//     const sheet = await AnswerSheet.findOne({
//       where: { answerSheetId, instituteId: requestedBy.instituteId, isDeleted: false },
//     });

//     if (!sheet) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Answer sheet not found.",
//       };
//     }

//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Answer sheet fetched.",
//       data: sheet,
//     };
//   } catch (e: any) {
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// // ─── EXAMINER: Approve answer sheet ──────────────────────────────────────────
// const approveAnswerSheet = async (
//   answerSheetId: string,
//   reviewer: any
// ): Promise<any> => {
//   try {
//     const sheet = await AnswerSheet.findOne({
//       where: { answerSheetId, instituteId: reviewer.instituteId, isDeleted: false },
//     });

//     if (!sheet) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Answer sheet not found.",
//       };
//     }

//     if (sheet.status !== "Submitted") {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "Only submitted answer sheets can be approved.",
//       };
//     }

//     await sheet.update({
//       status:        "Approved",
//       reviewedAt:    new Date(),
//       reviewedBy:    reviewer.userId,
//       rejectionNote: null,
//     });

//     // Check if both question paper AND answer sheet are approved
//     // If yes → exam goes Live
//     const paper = await QuestionPaper.findOne({
//       where: { paperId: sheet.paperId },
//     });

//     if (paper?.status === "Approved") {
//       await Exam.update(
//         { status: "Live" },
//         { where: { examId: sheet.examId } }
//       );
//     }

//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Answer sheet approved. Exam is now Live.",
//       data: sheet,
//     };
//   } catch (e: any) {
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// // ─── EXAMINER: Reject answer sheet with note ──────────────────────────────────
// const rejectAnswerSheet = async (
//   answerSheetId: string,
//   rejectionNote: string,
//   reviewer: any
// ): Promise<any> => {
//   try {
//     if (!rejectionNote?.trim()) {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "Rejection note is required.",
//       };
//     }

//     const sheet = await AnswerSheet.findOne({
//       where: { answerSheetId, instituteId: reviewer.instituteId, isDeleted: false },
//     });

//     if (!sheet) {
//       return {
//         error: true,
//         statusCode: httpStatus.NOT_FOUND,
//         message: "Answer sheet not found.",
//       };
//     }

//     if (sheet.status !== "Submitted") {
//       return {
//         error: true,
//         statusCode: httpStatus.BAD_REQUEST,
//         message: "Only submitted answer sheets can be rejected.",
//       };
//     }

//     await sheet.update({
//       status:        "Rejected",
//       rejectionNote: rejectionNote.trim(),
//       reviewedAt:    new Date(),
//       reviewedBy:    reviewer.userId,
//     });

//     return {
//       error: false,
//       statusCode: httpStatus.OK,
//       message: "Answer sheet rejected. Teacher has been notified.",
//       data: sheet,
//     };
//   } catch (e: any) {
//     return {
//       error: true,
//       statusCode: httpStatus.INTERNAL_SERVER_ERROR,
//       message: `Something went wrong: ${e.message}`,
//     };
//   }
// };

// export default {
//   saveAnswerSheet,
//   submitAnswerSheet,
//   getMyAnswerSheet,
//   getSubmittedAnswerSheets,
//   getAnswerSheetById,
//   approveAnswerSheet,
//   rejectAnswerSheet,
// };