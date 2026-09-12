"use strict";
// ─── OCR helpers for AI evaluation (Pipeline 6) ─────────────────────────────────
//
// 1. `ocrDocument` — the ONLY place that talks to the OCR server (ocr_server.py,
//    port 8000). Every call goes through a small limiter, so the OCR server never
//    receives more requests at once than EVAL_OCR_CONCURRENCY (default 1); extra
//    callers simply wait their turn.
//
// 2. `getAnswerKeyText` — OCR for an UPLOADED model answer sheet (PDF / image).
//    The file is read by OCR ONCE and the text is saved on the answer sheet row:
//
//        viaexam_question_paper_answers.answers = { pdfUrl, ocr: { text, sourceUrl, at } }
//
//    Every later student evaluation reuses the saved text instead of OCR-ing the
//    same model answer again. Re-uploading the PDF replaces `answers`, so a stale
//    cache is dropped automatically (and `sourceUrl` is checked as well).
//    Concurrent evaluations of the same answer key share ONE in-flight OCR run.
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
exports.warmAnswerKeyOcr = exports.getAnswerKeyText = exports.ocrDocument = exports.createLimiter = void 0;
const axios_1 = __importDefault(require("axios"));
const form_data_1 = __importDefault(require("form-data"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const stander_answer_model_1 = __importDefault(require("../modals/question-paper/stander-answer.model"));
const pythonServices_1 = require("../config/pythonServices");
const logger_1 = __importDefault(require("../config/logger"));
const OCR_TIMEOUT_MS = 3600000; // 1 hour — large multi-page PDFs on CPU are slow
const positiveInt = (value, fallback) => {
    const n = Number.parseInt(String(value !== null && value !== void 0 ? value : ""), 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
/** Runs at most `max` async tasks at a time; the rest wait in FIFO order. */
function createLimiter(max) {
    let active = 0;
    const waiting = [];
    return function run(task) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            if (active >= max) {
                yield new Promise((resolve) => waiting.push(resolve));
            }
            active++;
            try {
                return yield task();
            }
            finally {
                active--;
                (_a = waiting.shift()) === null || _a === void 0 ? void 0 : _a();
            }
        });
    };
}
exports.createLimiter = createLimiter;
const withOcrSlot = createLimiter(positiveInt(process.env.EVAL_OCR_CONCURRENCY, 1));
/** Sends one document to the OCR server and returns its markdown text. */
function ocrDocument(file, fileName, contentType) {
    return __awaiter(this, void 0, void 0, function* () {
        return withOcrSlot(() => __awaiter(this, void 0, void 0, function* () {
            var _a, _b;
            const form = new form_data_1.default();
            form.append("file", file, { filename: fileName, contentType: contentType || undefined });
            const res = yield axios_1.default.post(pythonServices_1.pythonServices.ocrUrl(), form, {
                headers: form.getHeaders(),
                timeout: OCR_TIMEOUT_MS,
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
            });
            return String((_b = (_a = res.data) === null || _a === void 0 ? void 0 : _a.combined_markdown) !== null && _b !== void 0 ? _b : "");
        }));
    });
}
exports.ocrDocument = ocrDocument;
/** Downloads an answer-key file (absolute URL, or a local /uploads path). */
function loadFile(url) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const ext = ((_b = (_a = url.split("?")[0].match(/\.(pdf|png|jpe?g|webp)$/i)) === null || _a === void 0 ? void 0 : _a[0]) !== null && _b !== void 0 ? _b : ".pdf").toLowerCase();
        const fileName = `answer_key${ext}`;
        if (/^https?:\/\//i.test(url)) {
            const res = yield axios_1.default.get(url, { responseType: "arraybuffer", timeout: 120000 });
            return { buffer: Buffer.from(res.data), fileName };
        }
        // Files stored by this server (e.g. "/uploads/…") are read straight from disk.
        const localPath = path_1.default.join(process.cwd(), url.replace(/^\/+/, "").replace(/^v1\//, ""));
        return { buffer: yield fs_1.default.promises.readFile(localPath), fileName };
    });
}
const parseAnswers = (value) => {
    let data = value;
    if (typeof data === "string") {
        try {
            data = JSON.parse(data);
        }
        catch (_a) {
            return null;
        }
    }
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
};
const inFlight = new Map();
/**
 * Text of an uploaded model answer sheet — from the saved OCR cache when present,
 * otherwise OCR-ed once, saved, and returned. Returns null when the answer sheet
 * has typed answers (nothing to OCR).
 */
function getAnswerKeyText(answerId) {
    var _a, _b;
    return __awaiter(this, void 0, void 0, function* () {
        const row = yield stander_answer_model_1.default.findOne({ where: { answerId } });
        const answers = parseAnswers(row === null || row === void 0 ? void 0 : row.answers);
        const sourceUrl = (answers === null || answers === void 0 ? void 0 : answers.pdfUrl) || (answers === null || answers === void 0 ? void 0 : answers.fileUrl);
        if (!row || !answers || !sourceUrl)
            return null;
        // Cache hit: this exact file was already read.
        if (((_a = answers.ocr) === null || _a === void 0 ? void 0 : _a.sourceUrl) === sourceUrl && typeof ((_b = answers.ocr) === null || _b === void 0 ? void 0 : _b.text) === "string" && answers.ocr.text.trim()) {
            return answers.ocr.text;
        }
        const key = `${answerId}:${sourceUrl}`;
        const running = inFlight.get(key);
        if (running)
            return running; // another evaluation is already reading this key
        const job = (() => __awaiter(this, void 0, void 0, function* () {
            logger_1.default.info(`[AnswerKey OCR] Reading uploaded model answer ${answerId} once: ${sourceUrl}`);
            const { buffer, fileName } = yield loadFile(sourceUrl);
            const text = (yield ocrDocument(buffer, fileName)).trim();
            if (!text)
                throw new Error("The OCR server returned no text for the uploaded model answer sheet.");
            // Save only if the file was not replaced while we were reading it.
            const fresh = yield stander_answer_model_1.default.findOne({ where: { answerId } });
            const freshAnswers = parseAnswers(fresh === null || fresh === void 0 ? void 0 : fresh.answers);
            if (fresh && freshAnswers && (freshAnswers.pdfUrl || freshAnswers.fileUrl) === sourceUrl) {
                yield fresh.update({
                    answers: Object.assign(Object.assign({}, freshAnswers), { ocr: { text, sourceUrl, at: new Date().toISOString() } }),
                });
            }
            logger_1.default.info(`[AnswerKey OCR] Saved OCR text for model answer ${answerId} (${text.length} chars).`);
            return text;
        }))().finally(() => inFlight.delete(key));
        inFlight.set(key, job);
        return job;
    });
}
exports.getAnswerKeyText = getAnswerKeyText;
/**
 * Starts reading a freshly uploaded model answer in the background, so the first
 * student evaluation does not have to wait for it. Failures are only logged — the
 * evaluation will simply try again.
 */
function warmAnswerKeyOcr(answerId) {
    getAnswerKeyText(answerId).catch((err) => logger_1.default.warn(`[AnswerKey OCR] Background read of model answer ${answerId} failed: ${(err === null || err === void 0 ? void 0 : err.message) || err}`));
}
exports.warmAnswerKeyOcr = warmAnswerKeyOcr;
