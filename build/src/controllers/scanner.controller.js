"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_status_1 = __importDefault(require("http-status"));
const scanner_service_1 = __importDefault(require("../services/scanner.service"));
// POST /uploadSheets  (multipart/form-data, field name: "sheets")
const uploadSheets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.uploadSheets(req.body, req.files, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("uploadSheets Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// PUT /replaceSheet/:sheetId  (multipart/form-data, field name: "sheet")
const replaceSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.replaceSheet(req.params.sheetId, req.file, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("replaceSheet Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// GET /getAllSheets?classId=&section=&subjectId=&examType=
const getAllSheets = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.getAllSheets(req.query, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("getAllSheets Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// GET /getFile/:sheetId  — streams the raw file
const getSheetFile = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.getSheetFile(req.params.sheetId, req.viaExamUser);
        if (result.error) {
            return res.status(result.statusCode).send(result);
        }
        const { buffer, mimeType, fileName, redirectUrl } = result.data;
        if (redirectUrl) {
            // Preferred path: the caller takes the short-lived signed URL and loads
            // the file straight from the CDN, so the bytes never touch this process.
            if (String(req.query.mode) === "url") {
                return res.status(http_status_1.default.OK).send({
                    error: false,
                    statusCode: http_status_1.default.OK,
                    message: "File located.",
                    data: { url: redirectUrl, mimeType, fileName },
                });
            }
            // Compatibility path: callers that expect raw bytes get them streamed
            // through. A 302 is not usable here — the browser would repeat the
            // request to Cloudinary in credentialed CORS mode and be blocked.
            const upstream = yield fetch(redirectUrl);
            if (!upstream.ok || !upstream.body) {
                return res.status(http_status_1.default.BAD_GATEWAY).json({
                    error: true,
                    statusCode: http_status_1.default.BAD_GATEWAY,
                    message: "The stored file could not be retrieved. Please try again.",
                });
            }
            res.setHeader("Content-Type", upstream.headers.get("content-type") || mimeType);
            res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
            const length = upstream.headers.get("content-length");
            if (length)
                res.setHeader("Content-Length", length);
            // Streamed rather than buffered so a 20 MB scan never sits on the heap.
            const { Readable } = yield Promise.resolve().then(() => __importStar(require("stream")));
            return Readable.fromWeb(upstream.body).pipe(res);
        }
        // Legacy sheet still held as a database blob.
        res.setHeader("Content-Type", mimeType);
        res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);
        return res.send(buffer);
    }
    catch (err) {
        console.error("getSheetFile Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// GET /summary?classId=&section=&subjectId=&examType=
const getSheetSummary = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.getSheetSummary(req.query, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("getSheetSummary Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// PATCH /updateStatus/:sheetId
const updateSheetStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.updateSheetStatus(req.params.sheetId, req.body.status, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("updateSheetStatus Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// DELETE /deleteSheet/:sheetId
const deleteSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.deleteSheet(req.params.sheetId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("deleteSheet Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// ─── APPROVAL WORKFLOW SCANNER ENDPOINTS ────────────────────────────────
// GET /approved-exams
const getApprovedExams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.getApprovedExams(req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("getApprovedExams Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// POST /upload-student-answer
const uploadStudentAnswerPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.uploadStudentAnswerPaper(req.body, req.file, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("uploadStudentAnswerPaper Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
// GET /student-answers/:examId
const getStudentAnswerPapers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scanner_service_1.default.getStudentAnswerPapers(req.params.examId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (err) {
        console.error("getStudentAnswerPapers Controller Error:", err);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: (err === null || err === void 0 ? void 0 : err.message) || "Internal Server Error",
        });
    }
});
exports.default = {
    uploadSheets,
    replaceSheet,
    getAllSheets,
    getSheetFile,
    getSheetSummary,
    updateSheetStatus,
    deleteSheet,
    getApprovedExams,
    uploadStudentAnswerPaper,
    getStudentAnswerPapers,
};
