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
const student_service_1 = __importDefault(require("../services/student.service"));
const config_1 = __importDefault(require("../config/config"));
const mailHelper_1 = require("../utils/mailHelper");
const createStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const result = yield student_service_1.default.createStudent(req.body, req.files, req.viaExamUser);
        if (!result.error) {
            const slug = (_b = (_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.institute) === null || _b === void 0 ? void 0 : _b.slug;
            const loginUrl = slug
                ? `${config_1.default.frontendUrl}/${slug}/auth/signin`
                : `${config_1.default.frontendUrl}/auth/signin`;
            (0, mailHelper_1.sendUserCredentials)({
                userName: `${req.body.firstName} ${req.body.lastName}`,
                email: req.body.email,
                phone: req.body.mobile,
                password: result.data.plainPassword,
                role: "Student",
                loginUrl,
            }).catch((err) => {
                console.error("Background student email dispatch failed:", err);
            });
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getAllStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield student_service_1.default.getAllStudents(req.viaExamUser, req.query);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getStudentById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield student_service_1.default.getStudentById(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const updateStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield student_service_1.default.updateStudent(req.params.userId, req.body, req.files, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const deleteStudent = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield student_service_1.default.deleteStudent(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const bulkCreateStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield student_service_1.default.bulkCreateStudents(req.body.students, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
exports.default = {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    deleteStudent,
    bulkCreateStudents,
};
