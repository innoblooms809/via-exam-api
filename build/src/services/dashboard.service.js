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
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const getInstituteStats = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const totalInstitutes = yield Institute_modal_1.default.count({
            where: {
                isDeleted: false,
            },
        });
        const activeInstitutes = yield Institute_modal_1.default.count({
            where: {
                isDeleted: false,
                status: 1,
            },
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Institute statistics fetched successfully.",
            data: {
                totalInstitutes,
                activeInstitutes,
            },
        };
    }
    catch (e) {
        console.error("getInstituteStats error:", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
const getStudentStats = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const totalStudents = yield Student_modal_1.default.count();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student statistics fetched successfully.",
            data: {
                totalStudents,
            },
        };
    }
    catch (e) {
        console.error("getStudentStats error:", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
const getExamStats = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const totalExams = yield Exam_modal_1.default.count({
            where: {
                isDeleted: false,
            },
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam statistics fetched successfully.",
            data: {
                totalExams,
            },
        };
    }
    catch (e) {
        console.error("getExamStats error:", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
const getEvaluatedAnswersheetStats = () => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const evaluatedSheets = yield Scanner_modal_1.default.count({
            where: {
                isDeleted: false,
                status: "Evaluated",
            },
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Evaluated answer sheets statistics fetched successfully.",
            data: {
                evaluatedAnswersheets: evaluatedSheets,
            },
        };
    }
    catch (e) {
        console.error("getEvaluatedAnswersheetStats error:", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
exports.default = {
    getInstituteStats,
    getStudentStats,
    getExamStats,
    getEvaluatedAnswersheetStats,
};
