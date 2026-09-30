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
exports.checkPythonServices = exports.describePythonServices = exports.pythonServices = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("./logger"));
/**
 * Python services — two separate servers, each configured by its own base URL (scheme + host + port):
 *
 *   OCR_SERVICE_URL=http://<ocr-ip>:8000         → ocr_server.py   (POST /ocrOutput)
 *   EVAL_SERVICE_URL=http://<eval-ip>:8006       → pipeline6.py    (POST /evaluate-text, /preprocess-exam, /visual-pre-eval)
 *
 * A per-endpoint *_URL variable, when set, overrides that single endpoint.
 * Values are read at call time, so they always reflect the loaded .env (restart after editing it).
 */
const firstSet = (...values) => values.map((v) => v === null || v === void 0 ? void 0 : v.trim()).find((v) => !!v);
const base = (value, fallback) => (firstSet(value) || fallback).replace(/\/+$/, "");
const ocrBase = () => base(process.env.OCR_SERVICE_URL, "http://localhost:8000");
const evalBase = () => base(process.env.EVAL_SERVICE_URL, "http://localhost:8006");
/** Legacy evaluation API lives on the evaluation host but on port 8002. */
const legacyEvalBase = () => {
    try {
        const url = new URL(evalBase());
        url.port = "8002";
        return url.origin;
    }
    catch (_a) {
        return "http://localhost:8002";
    }
};
exports.pythonServices = {
    // ── OCR server (ocr_server.py, port 8000) ──
    ocrUrl: () => firstSet(process.env.OCR_API_URL) || `${ocrBase()}/ocrOutput`,
    // ── Evaluation server (pipeline6.py, port 8006) ──
    pipelineUrl: () => firstSet(process.env.OCR_PIPELINE_URL) || `${evalBase()}/evaluate-text`,
    ocrNew5PipelineUrl: () => firstSet(process.env.OCRNEW5_PIPELINE_URL) || `${evalBase()}/evaluate-text`,
    pipeline6Url: () => firstSet(process.env.OCR6_PIPELINE_URL, process.env.PIPELINE6_API_URL, process.env.OCR_PIPELINE_URL) ||
        `${evalBase()}/evaluate-text`,
    pipeline6PreprocessUrl: () => firstSet(process.env.PIPELINE6_PREPROCESS_URL) || `${evalBase()}/preprocess-exam`,
    pipeline6VisualPreEvalUrl: () => firstSet(process.env.PIPELINE6_VISUAL_PREEVAL_URL) || `${evalBase()}/visual-pre-eval`,
    // ── Legacy evaluation API (port 8002) — only used by the old /evaluate route ──
    evaluationUrl: () => firstSet(process.env.EVALUATION_API_URL) || `${legacyEvalBase()}/evaluation`,
};
/** One-line summary for the startup log, so the active targets are visible after an .env change. */
const describePythonServices = () => `Python services → OCR ${ocrBase()} | Evaluation ${evalBase()}`;
exports.describePythonServices = describePythonServices;
/** Non-blocking startup check: pings GET /health on both servers and logs whether they are reachable. */
const checkPythonServices = () => __awaiter(void 0, void 0, void 0, function* () {
    const targets = [
        { name: "OCR", url: `${ocrBase()}/health` },
        { name: "Evaluation", url: `${evalBase()}/health` },
    ];
    yield Promise.all(targets.map(({ name, url }) => __awaiter(void 0, void 0, void 0, function* () {
        try {
            yield axios_1.default.get(url, { timeout: 5000 });
            logger_1.default.info(`${name} service reachable: ${url}`);
        }
        catch (err) {
            logger_1.default.warn(`${name} service NOT reachable: ${url} (${(err === null || err === void 0 ? void 0 : err.code) || (err === null || err === void 0 ? void 0 : err.message)})`);
        }
    })));
});
exports.checkPythonServices = checkPythonServices;
