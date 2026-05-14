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
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const sequelize_1 = require("sequelize");
// ─── CREATE EXAM ──────────────────────────────────────────────────────────────
const createExam = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Get instituteId from logged in admin/examiner
        const instituteId = createdBy.instituteId;
        if (!instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Institute not found for this user.",
            };
        }
        // 2. Validate teacher belongs to same institute
        const teacherRole = yield Role_modal_1.default.findOne({ where: { role: "TEACHER" } });
        const teacher = yield User_modal_1.default.findOne({
            where: {
                userId: body.teacherId,
                instituteId,
                roleId: teacherRole === null || teacherRole === void 0 ? void 0 : teacherRole.id,
                status: 1,
            },
        });
        console.log("Teacher Role =", teacherRole === null || teacherRole === void 0 ? void 0 : teacherRole.id);
        console.log("Institute =", instituteId);
        console.log("Teacher Name =", body.teacher);
        console.log("Teacher =", teacher);
        if (!teacher) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher not found in your institute.",
            };
        }
        // 3. Check duplicate exam
        const duplicate = yield Exam_modal_1.default.findOne({
            where: {
                instituteId,
                session: body.session,
                examType: body.examType,
                classVal: body.classVal,
                subject: body.subject,
                isDeleted: false,
            },
        });
        if (duplicate) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "An exam with same session, type, class and subject already exists.",
            };
        }
        // 4. Generate exam ID
        const examId = yield helper_1.default.generateUserId();
        // 5. Create exam
        const exam = yield Exam_modal_1.default.create({
            examId,
            instituteId,
            session: body.session,
            year: body.year,
            examType: body.examType,
            examDate: new Date(body.examDate),
            classVal: body.classVal,
            subject: body.subject,
            teacherId: teacher.userId,
            totalMarks: Number(body.totalMarks),
            passingMarks: Number(body.passingMarks),
            duration: body.duration ? Number(body.duration) : null,
            instructions: body.instructions || null,
            status: "Draft",
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Exam created successfully.",
            data: exam,
        };
    }
    catch (e) {
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET ALL EXAMS ────────────────────────────────────────────────────────────
const getAllExams = (query, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const { search = "", status = "", classVal = "" } = query;
        const where = { instituteId, isDeleted: false };
        if (status)
            where.status = status;
        if (classVal)
            where.classVal = classVal;
        if (search) {
            where[sequelize_1.Op.or] = [
                { examType: { [sequelize_1.Op.iLike]: `%${search}%` } },
                { subject: { [sequelize_1.Op.iLike]: `%${search}%` } },
                { classVal: { [sequelize_1.Op.iLike]: `%${search}%` } },
            ];
        }
        const exams = yield Exam_modal_1.default.findAll({
            where,
            order: [["createdAt", "DESC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exams fetched successfully.",
            data: { exams, total: exams.length },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET ONE EXAM ─────────────────────────────────────────────────────────────
const getExamById = (examId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exam = yield Exam_modal_1.default.findOne({
            where: { examId, isDeleted: false },
        });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        // Check institute access
        if (requestedBy.instituteId !== exam.instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Access denied.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam fetched successfully.",
            data: exam,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── UPDATE EXAM STATUS ───────────────────────────────────────────────────────
const updateExamStatus = (examId, status, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const allowed = ["Draft", "Live", "Completed"];
        if (!allowed.includes(status)) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Status must be one of: ${allowed.join(", ")}`,
            };
        }
        const exam = yield Exam_modal_1.default.findOne({ where: { examId, isDeleted: false } });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        if (requestedBy.instituteId !== exam.instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Access denied.",
            };
        }
        yield exam.update({ status });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Exam status updated to ${status}.`,
            data: exam,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── UPDATE EXAM  ───────────────────────────────────────────────────────
const updateExam = (examId, body, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const exam = yield Exam_modal_1.default.findOne({
            where: {
                examId,
                instituteId,
                isDeleted: false,
            },
        });
        if (!exam) {
            return {
                error: true,
                statusCode: 404,
                message: "Exam not found",
            };
        }
        // Optional Rule
        if (exam.status === "Completed") {
            return {
                error: true,
                statusCode: 400,
                message: "Completed exam cannot be updated",
            };
        }
        // Status Validation
        if (body.status) {
            const allowedStatus = ["Draft", "Live", "Completed"];
            if (!allowedStatus.includes(body.status)) {
                return {
                    error: true,
                    statusCode: 400,
                    message: "Status must be one of: Draft, Live, Completed",
                };
            }
        }
        yield exam.update({
            session: body.session || exam.session,
            year: body.year || exam.year,
            examType: body.examType || exam.examType,
            examDate: body.examDate || exam.examDate,
            classVal: body.classVal || exam.classVal,
            subject: body.subject || exam.subject,
            totalMarks: body.totalMarks || exam.totalMarks,
            passingMarks: body.passingMarks || exam.passingMarks,
            duration: body.duration || exam.duration,
            instructions: body.instructions || exam.instructions,
            status: body.status || exam.status,
        });
        return {
            error: false,
            statusCode: 200,
            message: "Exam updated successfully",
            data: exam,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: 500,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── SOFT DELETE EXAM ─────────────────────────────────────────────────────────
const deleteExam = (examId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exam = yield Exam_modal_1.default.findOne({ where: { examId, isDeleted: false } });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        if (requestedBy.instituteId !== exam.instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Access denied.",
            };
        }
        yield exam.update({ isDeleted: true });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam deleted successfully.",
            data: {},
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
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
