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
const mailHelper_1 = require("../utils/mailHelper");
const createTeacher = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        console.log(req.user);
        console.log(req.body);
        const result = yield teacher_service_1.default.createTeacher(req.body, req.files, req.viaExamUser);
        if (!result.error) {
            yield (0, mailHelper_1.sendEmailToNewUser)({
                emailId: req.body.emailId,
                phoneNumber: req.body.phoneNumber,
                userName: `${req.body.firstName} ${req.body.lastName}`,
                password: result.data.plainPassword,
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
exports.default = {
    createTeacher,
    getAllTeachers,
    getTeacherById,
    updateTeacher,
    deleteTeacher,
    assignExaminer,
    removeExaminer,
};
