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
// ─── CREATE SUBJECT ─────────────────────────────────────────────
const createSubject = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!body.classId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "classId is required.",
            };
        }
        if (!body.sessionId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "sessionId is required.",
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
        // Check duplicate
        const exists = yield Subject_modal_1.default.findOne({
            where: {
                instituteId,
                classId: body.classId,
                sectionId: body.sectionId || null,
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
        const newSubject = yield Subject_modal_1.default.create({
            subjectId,
            instituteId,
            sessionId: body.sessionId,
            classId: body.classId,
            sectionId: body.sectionId || null,
            subjectName: body.subjectName,
            subjectCode: body.subjectCode || null,
            teacherId: body.teacherId || null,
            totalMarks: body.totalMarks || 100,
            passingMarks: body.passingMarks || 35,
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
        if (query.sectionId) {
            where.sectionId = query.sectionId;
        }
        const subjects = yield Subject_modal_1.default.findAll({
            where,
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
    var _a, _b, _c, _d, _e;
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
            subjectName: (_a = body.subjectName) !== null && _a !== void 0 ? _a : subject.subjectName,
            subjectCode: (_b = body.subjectCode) !== null && _b !== void 0 ? _b : subject.subjectCode,
            teacherId: (_c = body.teacherId) !== null && _c !== void 0 ? _c : subject.teacherId,
            totalMarks: (_d = body.totalMarks) !== null && _d !== void 0 ? _d : subject.totalMarks,
            passingMarks: (_e = body.passingMarks) !== null && _e !== void 0 ? _e : subject.passingMarks,
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
