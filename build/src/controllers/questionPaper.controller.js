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
exports.createQuestionPaper = void 0;
const questionPaper_service_1 = require("../services/questionPaper.service");
const createQuestionPaper = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { instituteId, examId, teacherId, paperSet, content, } = req.body;
        console.log(req.body);
        // ─────────────────────────────────────────────
        // 1. Basic validation
        // ─────────────────────────────────────────────
        if (!instituteId ||
            !examId ||
            !teacherId ||
            !paperSet ||
            !content) {
            return res.status(400).json({
                message: "All fields are required",
            });
        }
        // ─────────────────────────────────────────────
        // 2. Call service
        // ─────────────────────────────────────────────
        const paper = yield questionPaper_service_1.QuestionPaperService.createQuestionPaper({
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
            message: error.message || "Something went wrong",
        });
    }
});
exports.createQuestionPaper = createQuestionPaper;
