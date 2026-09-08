"use strict";
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
        const { buffer, mimeType, fileName } = result.data;
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
exports.default = {
    uploadSheets,
    getAllSheets,
    getSheetFile,
    getSheetSummary,
    updateSheetStatus,
    deleteSheet,
};
