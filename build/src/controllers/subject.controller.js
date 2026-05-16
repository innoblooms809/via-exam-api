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
const subject_service_1 = __importDefault(require("../services/subject.service"));
const createSubject = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield subject_service_1.default.createSubject(req.body, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({
            error: true,
            statusCode: 500,
            message: "Internal Server Error",
        });
    }
});
const getAllSubjects = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield subject_service_1.default.getAllSubjects(req.query, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({
            error: true,
            statusCode: 500,
            message: "Internal Server Error",
        });
    }
});
const getSubjectById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield subject_service_1.default.getSubjectById(req.params.subjectId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({
            error: true,
            statusCode: 500,
            message: "Internal Server Error",
        });
    }
});
const updateSubject = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield subject_service_1.default.updateSubject(req.params.subjectId, req.body, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({
            error: true,
            statusCode: 500,
            message: "Internal Server Error",
        });
    }
});
const deleteSubject = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield subject_service_1.default.deleteSubject(req.params.subjectId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({
            error: true,
            statusCode: 500,
            message: "Internal Server Error",
        });
    }
});
exports.default = {
    createSubject,
    getAllSubjects,
    getSubjectById,
    updateSubject,
    deleteSubject,
};
