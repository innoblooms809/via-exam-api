import { Router } from "express";
import multer from "multer";
import Controller from "../../controllers/scanner.controller";
import { authenticate } from "../../middlewares/auth";

const router = Router();

// Store files in memory — buffer goes straight to DB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});

// Upload one or many sheets (multipart, field: "sheets")
router.post(
  "/uploadSheets",
  authenticate,
  upload.array("sheets", 100),       // max 100 files at once
  Controller.uploadSheets
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
  upload.single("answerPaperFile"),
  Controller.uploadStudentAnswerPaper
);

// Get student answer papers for a specific exam
router.get(
  "/student-answers/:examId",
  authenticate,
  Controller.getStudentAnswerPapers
);

export default router;