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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadImageController = exports.createQuestionPaper = void 0;
const questionPaper_service_1 = require("../services/questionPaper.service");
const getPaperSet = (paperSet, setLabel) => {
    const value = paperSet || (setLabel === null || setLabel === void 0 ? void 0 : setLabel.replace(/^set\s+/i, ""));
    const normalized = value === null || value === void 0 ? void 0 : value.trim().toUpperCase();
    if (normalized === "A" ||
        normalized === "B" ||
        normalized === "C" ||
        normalized === "D") {
        return normalized;
    }
    return undefined;
};
const getContent = (body, content) => {
    if (content)
        return content;
    const { instituteId, teacherId, paperSet, content: _content } = body, paperContent = __rest(body, ["instituteId", "teacherId", "paperSet", "content"]);
    return paperContent;
};
const createQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { instituteId, examId, teacherId, paperSet, content, } = req.body;
        console.log(req.body);
        const resolvedPaperSet = getPaperSet(paperSet, (_a = req.body.meta) === null || _a === void 0 ? void 0 : _a.setLabel);
        const resolvedContent = getContent(req.body, content);
        // ─────────────────────────────────────────────
        // 1. Basic validation
        // ─────────────────────────────────────────────
        if (!examId ||
            !resolvedPaperSet ||
            !resolvedContent) {
            return res.status(400).json({
                message: "examId, paperSet/meta.setLabel and paper content are required",
            });
        }
        // ─────────────────────────────────────────────
        // 2. Call service
        // ─────────────────────────────────────────────
        const paper = yield questionPaper_service_1.QuestionPaperService.createQuestionPaper({
            instituteId,
            examId,
            teacherId,
            paperSet: resolvedPaperSet,
            content: resolvedContent,
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
            message: error.message || "Something went wrong",
        });
    }
});
exports.createQuestionPaper = createQuestionPaper;
const uploadImageController = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _b;
    try {
        const files = req.files;
        const toUploadUrl = (file) => `/${file.path.replace(/\\/g, "/").replace(/^uploads\//, "v1/uploads/")}`;
        const diagramFiles = [
            ...((files === null || files === void 0 ? void 0 : files.diagram) || []),
            ...((files === null || files === void 0 ? void 0 : files.diagramUrls) || []),
        ];
        const diagramUrls = diagramFiles.map(toUploadUrl);
        const schoolLogo = ((_b = files === null || files === void 0 ? void 0 : files.schoolLogo) === null || _b === void 0 ? void 0 : _b[0])
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
