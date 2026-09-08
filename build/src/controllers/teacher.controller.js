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
const teacher_service_1 = __importDefault(require("../services/teacher.service"));
const config_1 = __importDefault(require("../config/config"));
const mailHelper_1 = require("../utils/mailHelper");
const createTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const result = yield teacher_service_1.default.createTeacher(req.body, req.files, req.viaExamUser);
        if (!result.error) {
            const slug = (_b = (_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.institute) === null || _b === void 0 ? void 0 : _b.slug;
            const loginUrl = slug
                ? `${config_1.default.frontendUrl}/${slug}/auth/signin`
                : `${config_1.default.frontendUrl}/auth/signin`;
            (0, mailHelper_1.sendUserCredentials)({
                userName: `${req.body.firstName} ${req.body.lastName}`,
                email: req.body.emailId,
                phone: req.body.phoneNumber,
                password: result.data.plainPassword,
                role: "Teacher",
                loginUrl,
            }).catch((err) => {
                console.error("Background teacher email dispatch failed:", err);
            });
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getAllTeachers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.getAllTeachers(req.viaExamUser, req.query);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        console.error("getAllTeachers Controller Error:", error);
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getTeacherById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.getTeacherById(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const updateTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.updateTeacher(req.params.userId, req.body, req.files, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const deleteTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.deleteTeacher(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const assignExaminer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.assignExaminer(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const removeExaminer = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.removeExaminer(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getDeactivatedTeachers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.getDeactivatedTeachers(req.viaExamUser, req.query);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        console.error("getDeactivatedTeachers Controller Error:", error);
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const reactivateTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.reactivateTeacher(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        console.error("reactivateTeacher Controller Error:", error);
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getMyAssignments = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield teacher_service_1.default.getMyAssignments(req.viaExamUser.userId);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getTeacherQuestionPapers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _c;
    try {
        const targetUserId = (_c = req.params) === null || _c === void 0 ? void 0 : _c.userId;
        const result = yield teacher_service_1.default.getTeacherQuestionPapers(req.viaExamUser, req.query, targetUserId);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        console.error("getTeacherQuestionPapers Controller Error:", error);
        return res.status(500).json({
            error: true,
            statusCode: 500,
            message: `Internal Server Error: ${error.message}`,
        });
    }
});
exports.default = {
    createTeacher,
    getAllTeachers,
    getTeacherById,
    updateTeacher,
    deleteTeacher,
    assignExaminer,
    removeExaminer,
    getDeactivatedTeachers,
    reactivateTeacher,
    getMyAssignments,
    getTeacherQuestionPapers,
};
