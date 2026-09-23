"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const scanner_controller_1 = __importDefault(require("../../controllers/scanner.controller"));
const auth_1 = require("../../middlewares/auth");
const answerSheetUpload_1 = require("../../middlewares/answerSheetUpload");
const uploadLimits_1 = require("../../config/uploadLimits");
const router = (0, express_1.Router)();
// Answer sheets are buffered to disk and streamed to Cloudinary; the row keeps
// only a URL. Size and count caps live in config/uploadLimits.ts and are
// enforced before the body is read — see middlewares/answerSheetUpload.ts.
// What the client may send in one batch. The scanner UI reads this to split a
// large selection into batches instead of guessing.
router.get("/uploadLimits", auth_1.authenticate, (_req, res) => {
    res.status(200).send({
        error: false,
        statusCode: 200,
        message: "Upload limits.",
        data: Object.assign(Object.assign({}, uploadLimits_1.ANSWER_SHEET_LIMITS), { summary: (0, uploadLimits_1.answerSheetLimitSummary)() }),
    });
});
// Upload one or many sheets (multipart, field: "sheets")
router.post("/uploadSheets", auth_1.authenticate, ...answerSheetUpload_1.answerSheetBatchUpload, scanner_controller_1.default.uploadSheets);
// Replace the scan behind an existing sheet (multipart, field: "sheet")
router.put("/replaceSheet/:sheetId", auth_1.authenticate, ...(0, answerSheetUpload_1.answerSheetSingleUpload)("sheet"), scanner_controller_1.default.replaceSheet);
// List sheets with filters
router.get("/getAllSheets", auth_1.authenticate, scanner_controller_1.default.getAllSheets);
// Stream raw file back (used by the iframe preview in your dashboard)
router.get("/getFile/:sheetId", auth_1.authenticate, scanner_controller_1.default.getSheetFile);
// Uploaded vs missing count for a given class/section/subject/exam
router.get("/summary", auth_1.authenticate, scanner_controller_1.default.getSheetSummary);
// Mark a sheet as Evaluated
router.patch("/updateStatus/:sheetId", auth_1.authenticate, scanner_controller_1.default.updateSheetStatus);
// Soft delete
router.delete("/deleteSheet/:sheetId", auth_1.authenticate, scanner_controller_1.default.deleteSheet);
// ─── APPROVAL WORKFLOW SCANNER ENDPOINTS ────────────────────────────────
// Get approved exams for scanner to upload student answer papers
router.get("/approved-exams", auth_1.authenticate, scanner_controller_1.default.getApprovedExams);
// Upload single student answer paper for approval workflow
router.post("/upload-student-answer", auth_1.authenticate, ...(0, answerSheetUpload_1.answerSheetSingleUpload)("answerPaperFile"), scanner_controller_1.default.uploadStudentAnswerPaper);
// Get student answer papers for a specific exam
router.get("/student-answers/:examId", auth_1.authenticate, scanner_controller_1.default.getStudentAnswerPapers);
exports.default = router;
