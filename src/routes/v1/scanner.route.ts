import { Router } from "express";
import Controller from "../../controllers/scanner.controller";
import { authenticate } from "../../middlewares/auth";
import {
  answerSheetBatchUpload,
  answerSheetSingleUpload,
} from "../../middlewares/answerSheetUpload";
import { ANSWER_SHEET_LIMITS, answerSheetLimitSummary } from "../../config/uploadLimits";

const router = Router();

// Answer sheets are buffered to disk and streamed to Cloudinary; the row keeps
// only a URL. Size and count caps live in config/uploadLimits.ts and are
// enforced before the body is read — see middlewares/answerSheetUpload.ts.

// What the client may send in one batch. The scanner UI reads this to split a
// large selection into batches instead of guessing.
router.get("/uploadLimits", authenticate, (_req, res) => {
  res.status(200).send({
    error: false,
    statusCode: 200,
    message: "Upload limits.",
    data: { ...ANSWER_SHEET_LIMITS, summary: answerSheetLimitSummary() },
  });
});

// Upload one or many sheets (multipart, field: "sheets")
router.post(
  "/uploadSheets",
  authenticate,
  ...answerSheetBatchUpload,
  Controller.uploadSheets
);

// Replace the scan behind an existing sheet (multipart, field: "sheet")
router.put(
  "/replaceSheet/:sheetId",
  authenticate,
  ...answerSheetSingleUpload("sheet"),
  Controller.replaceSheet
);

// List sheets with filters
router.get(
  "/getAllSheets",
  authenticate,
  Controller.getAllSheets
);

// Stream raw file back (used by the iframe preview in your dashboard)
router.get(
  "/getFile/:sheetId",
  authenticate,
  Controller.getSheetFile
);

// Uploaded vs missing count for a given class/section/subject/exam
router.get(
  "/summary",
  authenticate,
  Controller.getSheetSummary
);

// Mark a sheet as Evaluated
router.patch(
  "/updateStatus/:sheetId",
  authenticate,
  Controller.updateSheetStatus
);

// Soft delete
router.delete(
  "/deleteSheet/:sheetId",
  authenticate,
  Controller.deleteSheet
);

// ─── APPROVAL WORKFLOW SCANNER ENDPOINTS ────────────────────────────────

// Get approved exams for scanner to upload student answer papers
router.get(
  "/approved-exams",
  authenticate,
  Controller.getApprovedExams
);

// Upload single student answer paper for approval workflow
router.post(
  "/upload-student-answer",
  authenticate,
  ...answerSheetSingleUpload("answerPaperFile"),
  Controller.uploadStudentAnswerPaper
);

// Get student answer papers for a specific exam
router.get(
  "/student-answers/:examId",
  authenticate,
  Controller.getStudentAnswerPapers
);

export default router;