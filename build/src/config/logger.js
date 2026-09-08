"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const winston_1 = __importDefault(require("winston"));
const fs_1 = __importDefault(require("fs"));
const config_1 = __importDefault(require("./config"));
if (!fs_1.default.existsSync('logs')) {
    fs_1.default.mkdirSync('logs', { recursive: true });
}
const enumerateErrorFormat = winston_1.default.format((info) => {
    if (info instanceof Error) {
        Object.assign(info, { message: info.stack });
    }
    return info;
});
const consoleFormat = winston_1.default.format.combine(enumerateErrorFormat(), config_1.default.env === 'development' ? winston_1.default.format.colorize() : winston_1.default.format.uncolorize(), winston_1.default.format.splat(), winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston_1.default.format.printf(({ level, message, timestamp }) => `[${timestamp}] ${level}: ${message}`));
const fileJsonFormat = winston_1.default.format.combine(enumerateErrorFormat(), winston_1.default.format.timestamp(), winston_1.default.format.json());
const logger = winston_1.default.createLogger({
    level: config_1.default.env === 'development' ? 'debug' : 'info',
    transports: [
        new winston_1.default.transports.Console({
            stderrLevels: ['error'],
            format: consoleFormat,
        }),
        new winston_1.default.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: fileJsonFormat,
        }),
        new winston_1.default.transports.File({
            filename: 'logs/combined.log',
            format: fileJsonFormat,
        }),
    ],
});
exports.default = logger;
