"use strict";
// controllers/exam.controller.ts
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
exports.getExamBySelection = void 0;
const http_status_1 = __importDefault(require("http-status"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const getExamBySelection = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { classVal, subject, examType, teacherId } = req.body;
        console.log("getExamBySelection - Request Body:", req.body);
        // ─────────────────────────────────────────────
        // Validation
        // ─────────────────────────────────────────────
        if (!classVal ||
            !subject ||
            !examType ||
            !teacherId) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "classVal, subject, examType and teacherId are required",
            });
        }
        // ─────────────────────────────────────────────
        // Find Exam
        // ─────────────────────────────────────────────
        const exam = yield Exam_modal_1.default.findOne({
            where: {
                classVal,
                subject,
                examType,
                teacherId,
                isDeleted: false,
            },
            attributes: [
                "examId",
                "classVal",
                "subject",
                "examType",
                "session",
            ],
        });
        // ─────────────────────────────────────────────
        // Exam Not Found
        // ─────────────────────────────────────────────
        if (!exam) {
            return res.status(http_status_1.default.NOT_FOUND).json({
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "No exam found for selected Class, Subject and Exam Type",
            });
        }
        // ─────────────────────────────────────────────
        // Success
        // ─────────────────────────────────────────────
        return res.status(http_status_1.default.OK).json({
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam fetched successfully.",
            data: exam,
        });
    }
    catch (e) {
        console.error("getExamBySelection Error:", e);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        });
    }
});
exports.getExamBySelection = getExamBySelection;
