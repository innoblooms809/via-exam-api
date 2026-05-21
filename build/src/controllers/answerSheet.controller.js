"use strict";
// import httpStatus from "http-status";
// import { Response } from "express";
// import AnswerSheetService from "../services/answerSheet.service";
// const saveAnswerSheet = async (req: any, res: Response): Promise<any> => {
//   try {
//     const result = await AnswerSheetService.saveAnswerSheet(req.body, req.viaExamUser);
//     return res.status(result.statusCode).send(result);
//   } catch (e) {
//     return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
//   }
// };
// const submitAnswerSheet = async (req: any, res: Response): Promise<any> => {
//   try {
//     const result = await AnswerSheetService.submitAnswerSheet(
//       req.params.answerSheetId,
//       req.viaExamUser
//     );
//     return res.status(result.statusCode).send(result);
//   } catch (e) {
//     return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
//   }
// };
// const getMyAnswerSheet = async (req: any, res: Response): Promise<any> => {
//   try {
//     const result = await AnswerSheetService.getMyAnswerSheet(
//       req.params.paperId,
//       req.viaExamUser
//     );
//     return res.status(result.statusCode).send(result);
//   } catch (e) {
//     return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
//   }
// };
// const getSubmittedAnswerSheets = async (req: any, res: Response): Promise<any> => {
//   try {
//     const result = await AnswerSheetService.getSubmittedAnswerSheets(req.viaExamUser);
//     return res.status(result.statusCode).send(result);
//   } catch (e) {
//     return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
//   }
// };
// const getAnswerSheetById = async (req: any, res: Response): Promise<any> => {
//   try {
//     const result = await AnswerSheetService.getAnswerSheetById(
//       req.params.answerSheetId,
//       req.viaExamUser
//     );
//     return res.status(result.statusCode).send(result);
//   } catch (e) {
//     return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
//   }
// };
// const approveAnswerSheet = async (req: any, res: Response): Promise<any> => {
//   try {
//     const result = await AnswerSheetService.approveAnswerSheet(
//       req.params.answerSheetId,
//       req.viaExamUser
//     );
//     return res.status(result.statusCode).send(result);
//   } catch (e) {
//     return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
//   }
// };
// const rejectAnswerSheet = async (req: any, res: Response): Promise<any> => {
//   try {
//     const result = await AnswerSheetService.rejectAnswerSheet(
//       req.params.answerSheetId,
//       req.body.rejectionNote,
//       req.viaExamUser
//     );
//     return res.status(result.statusCode).send(result);
//   } catch (e) {
//     return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
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
