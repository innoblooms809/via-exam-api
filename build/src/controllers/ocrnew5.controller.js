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
const catchAsync_1 = __importDefault(require("../utils/catchAsync"));
const ocrnew5_service_1 = require("../services/ocrnew5.service");
const evaluateSheetOCRNew5Controller = (0, catchAsync_1.default)((req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { sheetId } = req.body;
    if (!sheetId) {
        return res.status(http_status_1.default.BAD_REQUEST).json({
            status: "error",
            message: "sheetId is required in request body",
        });
    }
    const result = yield (0, ocrnew5_service_1.evaluateSheetOCRNew5)(sheetId);
    return res.status(http_status_1.default.OK).json({
        status: "success",
        message: "ocrnew5 multi-agent evaluation complete.",
        data: result,
    });
}));
exports.default = {
    evaluateSheetOCRNew5: evaluateSheetOCRNew5Controller,
};
