"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const http_status_1 = __importDefault(require("http-status"));
const ApiError_1 = __importDefault(require("../utils/ApiError"));
const pick_1 = __importDefault(require("../utils/pick"));
const joi_1 = __importDefault(require("joi"));
const i18n_1 = __importStar(require("../i18n"));
/** Files multer wrote to disk for this request: a request that fails validation must not leave them behind. */
const removeUploadedFiles = (req) => {
    const files = [];
    if (Array.isArray(req.files))
        files.push(...req.files);
    else if (req.files && typeof req.files === 'object') {
        for (const group of Object.values(req.files))
            if (Array.isArray(group))
                files.push(...group);
    }
    if (req.file)
        files.push(req.file);
    for (const file of files)
        if (file === null || file === void 0 ? void 0 : file.path)
            fs_1.default.promises.unlink(file.path).catch(() => undefined);
};
/**
 * Several problems in one message, in the request's language: sentences one after another,
 * Joi's short default messages ("\"classId\" is required") as a list.
 */
const joinMessages = (messages, lng) => {
    var _a, _b;
    if (messages.every((m) => /[.!?؟।]$/.test(m)))
        return messages.join(' ');
    return messages.join(((_b = (_a = i18n_1.LANGUAGE_INFO[lng]) === null || _a === void 0 ? void 0 : _a.dir) !== null && _b !== void 0 ? _b : i18n_1.default.dir(lng)) === 'rtl' ? '، ' : ', ');
};
const validate = (schema) => (req, res, next) => {
    var _a, _b;
    const validSchema = (0, pick_1.default)(schema, ['params', 'query', 'body']);
    const obj = (0, pick_1.default)(req, Object.keys(validSchema));
    const { value, error } = joi_1.default.compile(validSchema)
        .prefs({ errors: { label: 'key' }, abortEarly: false })
        .validate(obj);
    if (error) {
        removeUploadedFiles(req);
        // Each schema message is an English key (locales/<language>/*.json).
        const lng = ((_a = req.i18n) === null || _a === void 0 ? void 0 : _a.resolvedLanguage) || req.language || 'en';
        const t = (_b = req.t) !== null && _b !== void 0 ? _b : i18n_1.default.getFixedT(lng);
        const messages = [...new Set(error.details.map((details) => String(t(details.message))))];
        return next(new ApiError_1.default(http_status_1.default.BAD_REQUEST, joinMessages(messages, lng)));
    }
    Object.assign(req, value);
    return next();
};
exports.default = validate;
