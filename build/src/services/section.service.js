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
const Section_modal_1 = __importDefault(require("../modals/Section.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
// ─── CREATE SECTION ───────────────────────────────────────────────────────────
const createSection = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!body.classId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "classId is required.",
            };
        }
        if (!body.sectionName) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "sectionName is required.",
            };
        }
        const classData = yield Class_modal_1.default.findOne({
            where: {
                classId: body.classId,
                instituteId: createdBy.instituteId,
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
        const exists = yield Section_modal_1.default.findOne({
            where: {
                classId: body.classId,
                sectionName: body.sectionName,
                isDeleted: false,
            },
        });
        if (exists) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Section already exists.",
            };
        }
        const sectionId = yield helper_1.default.generateUserId();
        const newSection = yield Section_modal_1.default.create({
            sectionId,
            classId: body.classId,
            instituteId: createdBy.instituteId,
            sessionId: classData.sessionId,
            sectionName: body.sectionName,
            classTeacherId: body.classTeacherId || null,
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Section created successfully.",
            data: newSection,
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
// ─── GET ALL SECTIONS ─────────────────────────────────────────────────────────
const getAllSections = (query, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const where = {
            instituteId: createdBy.instituteId,
            isDeleted: false,
            isActive: true,
        };
        if (query.classId) {
            where.classId = query.classId;
        }
        const sections = yield Section_modal_1.default.findAll({
            where,
            include: [
                {
                    model: User_modal_1.default,
                    as: "classTeacher",
                    attributes: ["userId", "userName", "emailId"],
                    required: false,
                },
            ],
            order: [["sectionName", "ASC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Sections fetched successfully.",
            data: {
                sections,
                total: sections.length,
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
// ─── GET SECTION BY ID ────────────────────────────────────────────────────────
const getSectionById = (sectionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const section = yield Section_modal_1.default.findOne({
            where: {
                sectionId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
            include: [
                {
                    model: User_modal_1.default,
                    as: "classTeacher",
                    attributes: ["userId", "userName", "emailId"],
                    required: false,
                },
            ],
        });
        if (!section) {
            return {
                error: true,
                statusCode: 404,
                message: "Section not found.",
            };
        }
        return {
            error: false,
            statusCode: 200,
            message: "Section fetched successfully.",
            data: section,
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
// ─── UPDATE SECTION ───────────────────────────────────────────────────────────
const updateSection = (sectionId, body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const section = yield Section_modal_1.default.findOne({
            where: {
                sectionId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        if (!section) {
            return {
                error: true,
                statusCode: 404,
                message: "Section not found.",
            };
        }
        yield section.update({
            sectionName: (_a = body.sectionName) !== null && _a !== void 0 ? _a : section.sectionName,
            classTeacherId: (_b = body.classTeacherId) !== null && _b !== void 0 ? _b : section.classTeacherId,
        });
        return {
            error: false,
            statusCode: 200,
            message: "Section updated successfully.",
            data: section,
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
// ─── DELETE SECTION ───────────────────────────────────────────────────────────
const deleteSection = (sectionId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const section = yield Section_modal_1.default.findOne({
            where: {
                sectionId,
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        if (!section) {
            return {
                error: true,
                statusCode: 404,
                message: "Section not found.",
            };
        }
        yield section.update({
            isDeleted: true,
            isActive: false,
        });
        return {
            error: false,
            statusCode: 200,
            message: "Section deleted successfully.",
            data: {},
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
exports.default = {
    createSection,
    getAllSections,
    getSectionById,
    updateSection,
    deleteSection,
};
