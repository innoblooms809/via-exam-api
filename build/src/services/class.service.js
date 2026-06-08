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
const User_modal_1 = __importDefault(require("../modals/User.modal"));
// ─── CREATE CLASS ─────────────────────────────────────────────────────────────
const createClass = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const className = (_a = body.className) === null || _a === void 0 ? void 0 : _a.trim();
        if (!className) {
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
                className,
            },
        });
        if (exists) {
            if (!exists.isDeleted) {
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: "Class already exists",
                };
            }
            else {
                // Restore the soft-deleted class
                yield exists.update({
                    isDeleted: false,
                    isActive: true,
                });
                return {
                    error: false,
                    statusCode: http_status_1.default.OK,
                    message: "Class restored successfully.",
                    data: exists,
                };
            }
        }
        const classId = yield helper_1.default.generateUserId();
        const newClass = yield Class_modal_1.default.create({
            classId,
            instituteId,
            className,
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Class created successfully.",
            data: newClass,
        };
    }
    catch (e) {
        console.error("POST /v1/class/createClass 500 - Error in service:", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: e.message,
        };
    }
});
// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = (createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const where = {
            instituteId: createdBy.instituteId,
            isActive: true,
            isDeleted: false,
        };
        const classes = yield Class_modal_1.default.findAll({
            where,
            include: [
                {
                    model: Section_modal_1.default,
                    as: "sections",
                    where: { isDeleted: false },
                    required: false,
                },
                {
                    model: Subject_modal_1.default,
                    as: "subjects",
                    where: { isDeleted: false },
                    required: false,
                },
                {
                    model: User_modal_1.default,
                    as: "classTeacher",
                    attributes: ["userId", "userName", "emailId"],
                    required: false,
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
                isDeleted: false,
            },
            include: [
                {
                    model: Section_modal_1.default,
                    as: "sections",
                    where: { isDeleted: false },
                    required: false,
                },
                {
                    model: Subject_modal_1.default,
                    as: "subjects",
                    where: { isDeleted: false },
                    required: false,
                },
                {
                    model: User_modal_1.default,
                    as: "classTeacher",
                    attributes: ["userId", "userName", "emailId"],
                    required: false,
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
    var _b;
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
        const className = (_b = body.className) === null || _b === void 0 ? void 0 : _b.trim();
        if (className) {
            const exists = yield Class_modal_1.default.findOne({
                where: {
                    instituteId: createdBy.instituteId,
                    className,
                },
            });
            if (exists && exists.classId !== classId) {
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: exists.isDeleted
                        ? "A deleted class with this name already exists. Please restore it or use a different name."
                        : "Class name already exists.",
                };
            }
        }
        yield classData.update({
            className: className !== null && className !== void 0 ? className : classData.className,
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
            where: { classId, instituteId: createdBy.instituteId, isDeleted: false },
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
