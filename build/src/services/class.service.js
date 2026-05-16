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
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const Section_modal_1 = __importDefault(require("../modals/Section.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
// ─── CREATE CLASS ─────────────────────────────────────────────────────────────
const createClass = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!body.sessionId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "sessionId is required.",
            };
        }
        if (!body.className) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "className is required.",
            };
        }
        const instituteId = createdBy.instituteId;
        const exists = yield Class_modal_1.default.findOne({
            where: {
                instituteId,
                sessionId: body.sessionId,
                className: body.className,
                isDeleted: false,
            },
        });
        if (exists) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Class already exists for this session.",
            };
        }
        const classId = yield helper_1.default.generateUserId();
        const newClass = yield Class_modal_1.default.create({
            classId,
            instituteId,
            sessionId: body.sessionId,
            className: body.className,
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Class created successfully.",
            data: newClass,
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
// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = (query, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const where = {
            instituteId: createdBy.instituteId,
            isActive: true,
            isDeleted: false,
        };
        if (query.sessionId) {
            where.sessionId = query.sessionId;
        }
        const classes = yield Class_modal_1.default.findAll({
            where,
            include: [
                {
                    model: Section_modal_1.default,
                    as: "sections",
                },
                {
                    model: Subject_modal_1.default,
                    as: "subjects",
                },
            ],
            order: [["className", "ASC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Classes fetched successfully.",
            data: {
                classes,
                total: classes.length,
            },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: 500,
            message: e.message,
        };
    }
});
// ─── GET ONE CLASS with students + exams ──────────────────────────────────────
const getClassById = (classId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const classData = yield Class_modal_1.default.findOne({
            where: {
                classId,
                instituteId: createdBy.instituteId,
            },
            include: [
                {
                    model: Section_modal_1.default,
                    as: "sections",
                },
                {
                    model: Subject_modal_1.default,
                    as: "subjects",
                },
            ],
        });
        if (!classData) {
            return {
                error: true,
                statusCode: 404,
                message: "Class not found.",
            };
        }
        return {
            error: false,
            statusCode: 200,
            message: "Class fetched successfully.",
            data: classData,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: 500,
            message: e.message,
        };
    }
});
// ─── UPDATE CLASS ─────────────────────────────────────────────────────────────
const updateClass = (classId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const classData = yield Class_modal_1.default.findOne({
            where: {
                classId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        if (!classData) {
            return {
                error: true,
                statusCode: 404,
                message: "Class not found.",
            };
        }
        yield classData.update({
            className: (_a = body.className) !== null && _a !== void 0 ? _a : classData.className,
            sessionId: (_b = body.sessionId) !== null && _b !== void 0 ? _b : classData.sessionId,
        });
        return {
            error: false,
            statusCode: 200,
            message: "Class updated successfully.",
            data: classData,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: 500,
            message: e.message,
        };
    }
});
// ─── DEACTIVATE CLASS ─────────────────────────────────────────────────────────
const deleteClass = (classId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const classData = yield Class_modal_1.default.findOne({
            where: { classId, instituteId: createdBy.instituteId },
        });
        if (!classData) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Class not found.",
            };
        }
        yield classData.update({
            isDeleted: true,
            isActive: false,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Class deactivated successfully.",
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
    createClass,
    getAllClasses,
    getClassById,
    updateClass,
    deleteClass,
};
