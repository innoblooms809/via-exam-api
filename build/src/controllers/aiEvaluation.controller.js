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
const aiEvaluation_service_1 = __importDefault(require("../services/aiEvaluation.service"));
const evaluationAccess_service_1 = require("../services/evaluationAccess.service");
// POST /v1/ai-evaluation/evaluate
const evaluateSheet = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { sheetId, force } = req.body;
        if (!sheetId) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "sheetId is required.",
            });
        }
        const result = yield aiEvaluation_service_1.default.triggerEvaluation(sheetId, force);
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: error.message || "Internal Server Error",
        });
    }
});
// GET /v1/ai-evaluation/sheet/:sheetId
const getEvaluation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { sheetId } = req.params;
        if (!sheetId) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "sheetId parameter is required.",
            });
        }
        const result = yield aiEvaluation_service_1.default.getEvaluationBySheetId(sheetId);
        // Assigned evaluators never receive the student's identity.
        if (!result.error && req.sheetAccess === "masked" && result.data) {
            result.data = (0, evaluationAccess_service_1.maskEvaluationIdentity)(result.data, req.accessSheet);
        }
        if (!result.error && result.data) {
            const plain = typeof result.data.toJSON === "function" ? result.data.toJSON() : result.data;
            result.data = Object.assign(Object.assign({}, plain), { canEvaluate: req.canEvaluate !== false });
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: error.message || "Internal Server Error",
        });
    }
});
// GET /v1/ai-evaluation/list
const getAllEvaluations = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const result = yield aiEvaluation_service_1.default.getAllEvaluations(req.query, req.viaExamUser);
        if (!result.error && Array.isArray((_a = result.data) === null || _a === void 0 ? void 0 : _a.evaluations)) {
            const evaluations = yield (0, evaluationAccess_service_1.scopeEvaluationRows)(req.viaExamUser, result.data.evaluations);
            result.data = Object.assign(Object.assign({}, result.data), { evaluations, total: evaluations.length });
        }
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: error.message || "Internal Server Error",
        });
    }
});
// PUT /v1/ai-evaluation/sheet/:sheetId
const updateEvaluation = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { sheetId } = req.params;
        const { totalScore, evaluations, feedback } = req.body;
        if (!sheetId) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "sheetId parameter is required.",
            });
        }
        const result = yield aiEvaluation_service_1.default.updateEvaluationBySheetId(sheetId, {
            totalScore,
            evaluations,
            feedback,
        });
        return res.status(result.statusCode).send(result);
    }
    catch (error) {
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: error.message || "Internal Server Error",
        });
    }
});
exports.default = {
    evaluateSheet,
    getEvaluation,
    getAllEvaluations,
    updateEvaluation,
};
