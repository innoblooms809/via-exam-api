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
const institute_service_1 = __importDefault(require("../services/institute.service"));
const registerInstitute = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // req.files comes from multer
        const result = yield institute_service_1.default.registerInstitute(req.body, req.files);
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
// ─── Get All ──────────────────────────────────────────────────────────────────
const getAllInstitutes = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield institute_service_1.default.getAllInstitutes(req.query);
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
// ─── Get One ──────────────────────────────────────────────────────────────────
const getInstituteById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield institute_service_1.default.getInstituteById(req.params.instituteId);
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
// ─── Update ───────────────────────────────────────────────────────────────────
const updateInstitute = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield institute_service_1.default.updateInstitute(req.params.instituteId, req.body, req.files);
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
// ─── Soft Delete ──────────────────────────────────────────────────────────────
const softDeleteInstitute = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield institute_service_1.default.softDeleteInstitute(req.params.instituteId);
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
// ─── Toggle Status ────────────────────────────────────────────────────────────
const toggleInstituteStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { status } = req.body;
        if (status === undefined || ![0, 1].includes(Number(status))) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Status must be 0 (inactive) or 1 (active).",
            });
        }
        const result = yield institute_service_1.default.toggleInstituteStatus(req.params.instituteId, Number(status));
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
    registerInstitute,
    getAllInstitutes,
    getInstituteById,
    updateInstitute,
    softDeleteInstitute,
    toggleInstituteStatus,
};
