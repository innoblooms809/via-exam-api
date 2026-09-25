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
const evaluationAccess_service_1 = require("../services/evaluationAccess.service");
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
            const recipientEmail = req.body.emailId || req.body.email;
            const recipientPhone = req.body.phoneNumber || req.body.mobile || req.body.phone;
            if (recipientEmail) {
                (0, mailHelper_1.sendUserCredentials)({
                    userName: `${req.body.firstName} ${req.body.lastName}`,
                    email: recipientEmail,
                    phone: recipientPhone || "",
                    password: result.data.plainPassword,
                    role: "Student",
                    loginUrl,
                }).catch((err) => {
                    console.error("Background student email dispatch failed:", err);
                });
            }
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getAllStudents = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _c, _d;
    try {
        console.log("GET /v1/student/getAllStudents - query:", req.query, "user:", (_c = req.viaExamUser) === null || _c === void 0 ? void 0 : _c.id);
        const result = yield student_service_1.default.getAllStudents(req.viaExamUser, req.query);
        // Teachers see real student details only for classes they teach; for any other
        // class (e.g. one they only evaluate) the identity is masked.
        if (!result.error && (0, evaluationAccess_service_1.isTeacherRequester)(req.viaExamUser) && Array.isArray((_d = result.data) === null || _d === void 0 ? void 0 : _d.students)) {
            const scope = yield (0, evaluationAccess_service_1.getTeacherScope)(req.viaExamUser);
            result.data.students = result.data.students.map((s) => { var _a; return scope.ownClassKeys.has(String((_a = s.className) !== null && _a !== void 0 ? _a : "")) ? s : (0, evaluationAccess_service_1.maskStudentRecord)(s); });
        }
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
    var _e;
    try {
        console.log("PUT /v1/student/updateStudent -", "params:", req.params, "body:", req.body, "user:", (_e = req.viaExamUser) === null || _e === void 0 ? void 0 : _e.id);
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
    var _f, _g, _h, _j, _k;
    try {
        const result = yield student_service_1.default.bulkCreateStudents((_f = req.body) === null || _f === void 0 ? void 0 : _f.students, req.viaExamUser);
        // Mirror the single-student flow: every student that was actually created
        // gets their login details by email. Dispatched in the background and one
        // at a time so a 500-row upload cannot stall the response or flood SMTP.
        const created = !result.error ? ((_h = (_g = result.data) === null || _g === void 0 ? void 0 : _g.successes) !== null && _h !== void 0 ? _h : []) : [];
        if (created.length > 0) {
            const slug = (_k = (_j = req.viaExamUser) === null || _j === void 0 ? void 0 : _j.institute) === null || _k === void 0 ? void 0 : _k.slug;
            const loginUrl = slug
                ? `${config_1.default.frontendUrl}/${slug}/auth/signin`
                : `${config_1.default.frontendUrl}/auth/signin`;
            void (() => __awaiter(void 0, void 0, void 0, function* () {
                for (const student of created) {
                    if (!student.generatedPassword)
                        continue; // admin set the password themselves
                    try {
                        yield (0, mailHelper_1.sendUserCredentials)({
                            userName: student.name,
                            email: student.email,
                            phone: student.mobile,
                            password: student.generatedPassword,
                            role: "Student",
                            loginUrl,
                        });
                    }
                    catch (err) {
                        console.error(`Background bulk student email dispatch failed for ${student.email}:`, err);
                    }
                }
            }))();
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        console.error("bulkCreateStudents controller error:", error);
        return res
            .status(500)
            .json({ error: true, statusCode: 500, message: "Internal Server Error" });
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
