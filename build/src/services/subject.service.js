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
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
// ─── CREATE SUBJECT ─────────────────────────────────────────────
const createSubject = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        if (!body.classId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "classId is required.",
            };
        }
        if (!body.subjectName) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "subjectName is required.",
            };
        }
        const instituteId = createdBy.instituteId;
        const classData = yield Class_modal_1.default.findOne({
            where: {
                classId: body.classId,
                instituteId,
                isDeleted: false,
            },
        });
        if (!classData) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Class not found.",
            };
        }
        if (body.teacherId) {
            const teacher = yield User_modal_1.default.findOne({
                where: {
                    userId: body.teacherId,
                    instituteId,
                    isDeleted: false,
                },
            });
            if (!teacher) {
                return {
                    error: true,
                    statusCode: http_status_1.default.NOT_FOUND,
                    message: "Teacher not found.",
                };
            }
        }
        // Check duplicate
        const exists = yield Subject_modal_1.default.findOne({
            where: {
                instituteId,
                classId: body.classId,
                subjectName: body.subjectName,
                isDeleted: false,
            },
        });
        if (exists) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Subject already exists.",
            };
        }
        const subjectId = yield helper_1.default.generateUserId();
        if (body.passingMarks &&
            body.totalMarks &&
            body.passingMarks > body.totalMarks) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Passing marks cannot be greater than total marks.",
            };
        }
        const newSubject = yield Subject_modal_1.default.create({
            subjectId,
            instituteId,
            classId: body.classId,
            subjectName: body.subjectName,
            subjectCode: (_a = body.subjectCode) !== null && _a !== void 0 ? _a : null,
            teacherId: (_b = body.teacherId) !== null && _b !== void 0 ? _b : null,
            totalMarks: (_c = body.totalMarks) !== null && _c !== void 0 ? _c : 100,
            passingMarks: (_d = body.passingMarks) !== null && _d !== void 0 ? _d : 35,
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Subject created successfully.",
            data: newSubject,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: e.message,
        };
    }
});
// ─── GET ALL SUBJECTS ──────────────────────────────────────────
const getAllSubjects = (query, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const where = {
            instituteId: createdBy.instituteId,
            isDeleted: false,
            isActive: true,
        };
        if (query.classId) {
            where.classId = query.classId;
        }
        const subjects = yield Subject_modal_1.default.findAll({
            where,
            include: [
                {
                    model: Class_modal_1.default,
                    as: "class",
                },
                {
                    model: User_modal_1.default,
                    as: "teacher",
                    attributes: ["userId", "userName", "emailId"],
                    required: false,
                },
            ],
            order: [["subjectName", "ASC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subjects fetched successfully.",
            data: {
                subjects,
                total: subjects.length,
            },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: e.message,
        };
    }
});
// ─── GET SUBJECT BY ID ─────────────────────────────────────────
const getSubjectById = (subjectId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const subject = yield Subject_modal_1.default.findOne({
            where: {
                subjectId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
            include: [
                {
                    model: Class_modal_1.default,
                    as: "class",
                },
                {
                    model: User_modal_1.default,
                    as: "teacher",
                    attributes: ["userId", "userName", "emailId"],
                    required: false,
                },
            ],
        });
        if (!subject) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Subject not found.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subject fetched successfully.",
            data: subject,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: e.message,
        };
    }
});
// ─── UPDATE SUBJECT ────────────────────────────────────────────
const updateSubject = (subjectId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _e, _f, _g, _h, _j;
    try {
        const subject = yield Subject_modal_1.default.findOne({
            where: {
                subjectId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        if (!subject) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Subject not found.",
            };
        }
        if (body.subjectName) {
            const exists = yield Subject_modal_1.default.findOne({
                where: {
                    instituteId: createdBy.instituteId,
                    classId: subject.classId,
                    subjectName: body.subjectName,
                    isDeleted: false,
                },
            });
            if (exists && exists.subjectId !== subjectId) {
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: "Subject name already exists in this class.",
                };
            }
        }
        if (body.teacherId) {
            const teacher = yield User_modal_1.default.findOne({
                where: {
                    userId: body.teacherId,
                    instituteId: createdBy.instituteId,
                    isDeleted: false,
                },
            });
            if (!teacher) {
                return {
                    error: true,
                    statusCode: http_status_1.default.NOT_FOUND,
                    message: "Teacher not found.",
                };
            }
        }
        const totalMarks = (_e = body.totalMarks) !== null && _e !== void 0 ? _e : subject.totalMarks;
        const passingMarks = (_f = body.passingMarks) !== null && _f !== void 0 ? _f : subject.passingMarks;
        if (passingMarks > totalMarks) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Passing marks cannot be greater than total marks.",
            };
        }
        yield subject.update({
            subjectName: (_g = body.subjectName) !== null && _g !== void 0 ? _g : subject.subjectName,
            subjectCode: (_h = body.subjectCode) !== null && _h !== void 0 ? _h : subject.subjectCode,
            teacherId: (_j = body.teacherId) !== null && _j !== void 0 ? _j : subject.teacherId,
            totalMarks,
            passingMarks,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subject updated successfully.",
            data: subject,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: e.message,
        };
    }
});
// ─── DELETE SUBJECT (SOFT DELETE) ─────────────────────────────
const deleteSubject = (subjectId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const subject = yield Subject_modal_1.default.findOne({
            where: {
                subjectId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        if (!subject) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Subject not found.",
            };
        }
        yield subject.update({
            isDeleted: true,
            isActive: false,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Subject deleted successfully.",
            data: {},
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: e.message,
        };
    }
});
exports.default = {
    createSubject,
    getAllSubjects,
    getSubjectById,
    updateSubject,
    deleteSubject,
};
