import { Router } from "express";
import Controller from "../../../controllers/scanner/scanner.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import {
  answerSheetBatchUpload,
  answerSheetSingleUpload,
} from "../../../middlewares/answerSheetUpload";
import { ANSWER_SHEET_LIMITS, answerSheetLimitSummary } from "../../../config/uploadLimits";
import { ACADEMIC, STAFF, UPLOADERS } from "../../../config/roles";

// Answer sheets go in, are replaced or removed by scanner staff only; the admin views them.
const SCANNERS = ["SCANNER"];

const router = Router();

// Answer sheets are buffered to disk and streamed to Cloudinary; the row keeps
// only a URL. Size and count caps live in config/uploadLimits.ts and are
// enforced before the body is read — see middlewares/answerSheetUpload.ts.
// Only the school admin and scanner accounts may add, replace or delete sheets.

// What the client may send in one batch. The scanner UI reads this to split a
// large selection into batches instead of guessing.
router.get("/uploadLimits", authenticate, authorize(SCANNERS), (_req, res) => {
  res.status(200).send({
    error: false,
    statusCode: 200,
    message: "Upload limits.",
    data: { ...ANSWER_SHEET_LIMITS, summary: answerSheetLimitSummary() },
  });
});

// Upload one or many sheets (multipart, field: "sheets")
router.post("/uploadSheets", authenticate, authorize(SCANNERS), ...answerSheetBatchUpload, Controller.uploadSheets);

// Replace the scan behind an existing sheet (multipart, field: "sheet")
router.put(
  "/replaceSheet/:sheetId",
  authenticate,
  authorize(SCANNERS),
  ...answerSheetSingleUpload("sheet"),
  Controller.replaceSheet
);

// List sheets with filters
router.get("/getAllSheets", authenticate, authorize(STAFF), Controller.getAllSheets);

// Stream raw file back (used by the iframe preview in your dashboard)
router.get("/getFile/:sheetId", authenticate, authorize(STAFF), Controller.getSheetFile);

// Uploaded vs missing count for a given class/section/subject/exam
router.get("/summary", authenticate, authorize(STAFF), Controller.getSheetSummary);

// Mark a sheet as Evaluated
router.patch("/updateStatus/:sheetId", authenticate, authorize(ACADEMIC), Controller.updateSheetStatus);

// Soft delete
router.delete("/deleteSheet/:sheetId", authenticate, authorize(SCANNERS), Controller.deleteSheet);

// ─── APPROVAL WORKFLOW SCANNER ENDPOINTS ────────────────────────────────

// Approved exams the scanner may upload answer papers for
router.get("/approved-exams", authenticate, authorize(UPLOADERS), Controller.getApprovedExams);

// Upload single student answer paper for approval workflow
router.post(
  "/upload-student-answer",
  authenticate,
  authorize(SCANNERS),
  ...answerSheetSingleUpload("answerPaperFile"),
  Controller.uploadStudentAnswerPaper
);

// Get student answer papers for a specific exam
router.get("/student-answers/:examId", authenticate, authorize(STAFF), Controller.getStudentAnswerPapers);

export default router;
