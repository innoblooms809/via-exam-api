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
const exam_service_1 = __importDefault(require("../services/exam.service"));
const createExam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield exam_service_1.default.createExam(req.body, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const getAllExams = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield exam_service_1.default.getAllExams(req.query, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const getExamById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield exam_service_1.default.getExamById(req.params.examId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const updateExamStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield exam_service_1.default.updateExamStatus(req.params.examId, req.body.status, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const updateExam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield exam_service_1.default.updateExam(req.params.examId, req.body, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
const deleteExam = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield exam_service_1.default.deleteExam(req.params.examId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
exports.default = {
    createExam,
    getAllExams,
    getExamById,
    updateExamStatus,
    updateExam,
    deleteExam,
};
