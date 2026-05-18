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
const class_service_1 = __importDefault(require("../services/class.service"));
// ─── CREATE CLASS ─────────────────────────────────────────────────────────────
const createClass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield class_service_1.default.createClass(req.body, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield class_service_1.default.getAllClasses(req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ─── GET CLASS BY ID ──────────────────────────────────────────────────────────
const getClassById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield class_service_1.default.getClassById(req.params.classId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ─── UPDATE CLASS ─────────────────────────────────────────────────────────────
const updateClass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield class_service_1.default.updateClass(req.params.classId, req.body, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
// ─── DELETE CLASS ─────────────────────────────────────────────────────────────
const deleteClass = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield class_service_1.default.deleteClass(req.params.classId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Internal Server Error",
        });
    }
});
exports.default = {
    createClass,
    getAllClasses,
    getClassById,
    updateClass,
    deleteClass,
};
