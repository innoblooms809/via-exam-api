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
const scannerUser_service_1 = __importDefault(require("../services/scannerUser.service"));
const config_1 = __importDefault(require("../config/config"));
const mailHelper_1 = require("../utils/mailHelper");
const createScanner = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const result = yield scannerUser_service_1.default.createScanner(req.body, req.files, req.viaExamUser);
        if (!result.error) {
            const slug = (_b = (_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.institute) === null || _b === void 0 ? void 0 : _b.slug;
            const loginUrl = slug
                ? `${config_1.default.frontendUrl}/${slug}/auth/signin`
                : `${config_1.default.frontendUrl}/auth/signin`;
            (0, mailHelper_1.sendUserCredentials)({
                userName: `${req.body.firstName} ${req.body.lastName}`,
                email: req.body.email,
                phone: req.body.mobile,
                password: result.data.plainPassword,
                role: "Scanner",
                loginUrl,
            }).catch((err) => {
                console.error("Background scanner email dispatch failed:", err);
            });
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getAllScanners = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scannerUser_service_1.default.getAllScanners(req.viaExamUser, req.query);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const getScannerById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scannerUser_service_1.default.getScannerById(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const updateScanner = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scannerUser_service_1.default.updateScanner(req.params.userId, req.body, req.files, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const deleteScanner = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scannerUser_service_1.default.deleteScanner(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
const reactivateScanner = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const result = yield scannerUser_service_1.default.reactivateScanner(req.params.userId, req.viaExamUser);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        console.error("reactivateScanner Controller Error:", error);
        return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
    }
});
exports.default = {
    createScanner,
    getAllScanners,
    getScannerById,
    updateScanner,
    deleteScanner,
    reactivateScanner,
};
