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
const pipeline6_service_1 = __importDefault(require("../services/pipeline6.service"));
// POST /v1/ai-evaluation/evaluate2
// Kept for existing callers — it now uses Pipeline 6 (the main evaluation) so every
// request goes through the same queue instead of hitting the Python servers directly.
const evaluateSheet2 = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { sheetId, force } = req.body;
        if (!sheetId) {
            return res.status(http_status_1.default.BAD_REQUEST).json({
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "sheetId is required.",
            });
        }
        const result = yield pipeline6_service_1.default.triggerPipeline6Evaluation(sheetId, force);
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
    evaluateSheet2,
};
