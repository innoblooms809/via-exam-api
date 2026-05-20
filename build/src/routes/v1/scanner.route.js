"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const scanner_controller_1 = __importDefault(require("../../controllers/scanner.controller"));
const auth_1 = require("../../middlewares/auth");
const router = (0, express_1.Router)();
// Store files in memory — buffer goes straight to DB
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB per file
});
// Upload one or many sheets (multipart, field: "sheets")
router.post("/uploadSheets", auth_1.authenticate, upload.array("sheets", 100), // max 100 files at once
scanner_controller_1.default.uploadSheets);
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
exports.default = router;
