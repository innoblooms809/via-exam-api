import { Router } from "express";
import Controller from "../../../controllers/scanner/scanner.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import validate from "../../../middlewares/validate";
import scannerValidation from "../../../validations/scanner.validation";
import {
  answerSheetBatchUpload,
  answerSheetSingleUpload,
} from "../../../middlewares/answerSheetUpload";
import { ANSWER_SHEET_LIMITS, answerSheetLimitSummary } from "../../../config/uploadLimits";
import { STAFF } from "../../../config/roles";

// Answer sheets go in, are replaced or removed by scanner staff only; the admin views them.
const SCANNERS = ["SCANNER"];

const router = Router();

// Answer sheets are buffered to disk, then stored under uploads/private/; the row
// keeps only where the file is. Size and count caps live in config/uploadLimits.ts and are
// enforced before the body is read — see middlewares/answerSheetUpload.ts.
// Only the school admin and scanner accounts may add, replace or delete sheets.
//
// Requests are checked by validations/scanner.validation.ts: ids in the address before the
// upload is read, the fields of a multipart form once multer has read them (a refused form's
// files are deleted). Names may be Arabic and roll numbers typed in any script's digits.

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
router.post(
  "/uploadSheets",
  authenticate,
  authorize(SCANNERS),
  ...answerSheetBatchUpload,
  validate(scannerValidation.uploadSheets),
  Controller.uploadSheets
);

// Replace the scan behind an existing sheet (multipart, field: "sheet")
router.put(
  "/replaceSheet/:sheetId",
  authenticate,
  authorize(SCANNERS),
  validate(scannerValidation.sheetById),
  ...answerSheetSingleUpload("sheet"),
  Controller.replaceSheet
);

// List sheets with filters
router.get("/getAllSheets", authenticate, authorize(STAFF), validate(scannerValidation.getAllSheets), Controller.getAllSheets);

// Stream raw file back (used by the iframe preview in your dashboard)
router.get("/getFile/:sheetId", authenticate, authorize(STAFF), validate(scannerValidation.sheetById), Controller.getSheetFile);

// Soft delete
router.delete("/deleteSheet/:sheetId", authenticate, authorize(SCANNERS), validate(scannerValidation.sheetById), Controller.deleteSheet);

export default router;
