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
exports.QuestionPaperService = void 0;
const QuestionPaper_modal_1 = __importDefault(require("../../modals/question-paper/QuestionPaper.modal"));
const Exam_modal_1 = __importDefault(require("../../modals/Exam.modal"));
const helper_1 = __importDefault(require("../../utils/helper"));
class QuestionPaperService {
    // ─────────────────────────────────────────────
    // CREATE QUESTION PAPER
    // ─────────────────────────────────────────────
    static createQuestionPaper(data) {
        return __awaiter(this, void 0, void 0, function* () {
            const { instituteId, examId, teacherId, paperSet, content, } = data;
            // ─────────────────────────────────────────────
            // Validate teacherId
            // ─────────────────────────────────────────────
            if (!teacherId) {
                throw new Error("teacherId is required");
            }
            // ─────────────────────────────────────────────
            // Find Exam
            // ─────────────────────────────────────────────
            const exam = yield Exam_modal_1.default.findOne({
                where: { examId },
            });
            if (!exam) {
                throw new Error("Exam not found");
            }
            // ─────────────────────────────────────────────
            // Resolve instituteId
            // ─────────────────────────────────────────────
            const resolvedInstituteId = instituteId || exam.instituteId;
            // ─────────────────────────────────────────────
            // Check if this Set already exists for the exam
            // ─────────────────────────────────────────────
            const existing = yield QuestionPaper_modal_1.default.findOne({
                where: { examId, paperSet },
            });
            if (existing) {
                throw new Error(`Question Paper Set ${paperSet} already exists for this exam`);
            }
            // ─────────────────────────────────────────────
            // Generate Paper ID
            // ─────────────────────────────────────────────
            const resolvedPaperId = yield helper_1.default.generateUserId();
            // ─────────────────────────────────────────────
            // Create Question Paper
            // ─────────────────────────────────────────────
            const paper = yield QuestionPaper_modal_1.default.create({
                paperId: resolvedPaperId,
                instituteId: resolvedInstituteId,
                examId,
                teacherId,
                paperSet,
                content,
                status: "DRAFT",
            });
            return paper;
        });
    }
}
exports.QuestionPaperService = QuestionPaperService;
