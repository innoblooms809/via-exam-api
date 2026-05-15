"use strict";
// import httpStatus from "http-status";
// import { Request, Response } from "express";
// import QuestionPaperService from "../services/questionPaper.service";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImageController = exports.createQuestionPaper = void 0;
const sequelize_1 = require("sequelize");
const questionPaper_service_1 = require("../services/questionPaper.service");
const getQuestionPaperErrorMessage = (error) => {
    var _a, _b, _c;
    if (error instanceof sequelize_1.UniqueConstraintError) {
        const fields = Object.keys(error.fields || {});
        if (fields.includes("paperId")) {
            return "Question paper ID already exists";
        }
        return ((_b = (_a = error.errors) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) || "Duplicate question paper data";
    }
    if (error instanceof sequelize_1.ForeignKeyConstraintError) {
        return "Invalid institute, exam, or teacher selected";
    }
    if (error instanceof sequelize_1.ValidationError) {
        return ((_c = error.errors) === null || _c === void 0 ? void 0 : _c.map((item) => item.message).join(", ")) || error.message;
    }
    return error.message || "Something went wrong";
};
const createQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { paperId, instituteId, examId, teacherId, paperSet, content, } = req.body;
        console.log(req.body);
        // ─────────────────────────────────────────────
        // 1. Basic validation
        // ─────────────────────────────────────────────
        if (!instituteId ||
            !examId ||
            !paperSet ||
            !content) {
            return res.status(400).json({
                message: "All fields are required",
            });
        }
        if (teacherId !== undefined && typeof teacherId !== "string") {
            return res.status(400).json({
                message: "teacherId must be a string",
            });
        }
        if (paperId !== undefined && typeof paperId !== "string") {
            return res.status(400).json({
                message: "paperId must be a string",
            });
        }
        // ─────────────────────────────────────────────
        // 2. Call service
        // ─────────────────────────────────────────────
        const paper = yield questionPaper_service_1.QuestionPaperService.createQuestionPaper({
            paperId,
            instituteId,
            examId,
            teacherId,
            paperSet,
            content,
        });
        // ─────────────────────────────────────────────
        // 3. Response
        // ─────────────────────────────────────────────
        return res.status(201).json({
            message: "Question paper created successfully",
            data: paper,
        });
    }
    catch (error) {
        return res.status(400).json({
            message: getQuestionPaperErrorMessage(error),
        });
    }
});
exports.createQuestionPaper = createQuestionPaper;
const uploadImageController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const files = req.files;
        const toUploadUrl = (file) => `/${file.path.replace(/\\/g, "/").replace(/^uploads\//, "uploads/")}`;
        const diagramFiles = [
            ...((files === null || files === void 0 ? void 0 : files.diagram) || []),
            ...((files === null || files === void 0 ? void 0 : files.diagramUrls) || []),
        ];
        const diagramUrls = diagramFiles.map(toUploadUrl);
        const schoolLogo = ((_a = files === null || files === void 0 ? void 0 : files.schoolLogo) === null || _a === void 0 ? void 0 : _a[0])
            ? toUploadUrl(files.schoolLogo[0])
            : null;
        return res.status(200).json({
            error: false,
            message: "Images uploaded successfully",
            data: {
                schoolLogo,
                diagramUrls,
            },
        });
    }
    catch (e) {
        return res.status(500).json({
            error: true,
            message: e.message,
        });
    }
});
exports.uploadImageController = uploadImageController;
