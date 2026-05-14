"use strict";
// import { Router } from "express";
// import Controller from "../controllers/answerSheet.controller";
// import { authenticate, authorize } from "../middlewares/auth";
// const router = Router();
// // ── Teacher routes ────────────────────────────────────────────────────────────
// // Save draft answer sheet
// router.post(
//   "/",
//   authenticate,
//   authorize(["TEACHER"]),
//   Controller.saveAnswerSheet
// );
// // Submit for review
// router.patch(
//   "/:answerSheetId/submit",
//   authenticate,
//   authorize(["TEACHER"]),
//   Controller.submitAnswerSheet
// );
// // Get my answer sheet for a paper
// router.get(
//   "/my/:paperId",
//   authenticate,
//   authorize(["TEACHER"]),
//   Controller.getMyAnswerSheet
// );
// // ── Examiner/Admin routes ─────────────────────────────────────────────────────
// // Get all submitted answer sheets
// router.get(
//   "/submitted",
//   authenticate,
//   authorize(["ADMIN", "EXAMINER"]),
//   Controller.getSubmittedAnswerSheets
// );
// // Get one answer sheet
// router.get(
//   "/:answerSheetId",
//   authenticate,
//   authorize(["ADMIN", "EXAMINER"]),
//   Controller.getAnswerSheetById
// );
// // Approve
// router.patch(
//   "/:answerSheetId/approve",
//   authenticate,
//   authorize(["ADMIN", "EXAMINER"]),
//   Controller.approveAnswerSheet
// );
// // Reject with note
// router.patch(
//   "/:answerSheetId/reject",
//   authenticate,
//   authorize(["ADMIN", "EXAMINER"]),
//   Controller.rejectAnswerSheet
// );
// export default router;
