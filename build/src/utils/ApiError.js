"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const message_1 = require("../i18n/message");
class ApiError extends Error {
    constructor(statusCode, message, isOperational = true, stack = '') {
        super(message === undefined ? undefined : String(message));
        this.statusCode = statusCode;
        this.isOperational = isOperational;
        if (message instanceof message_1.LocalizedMessage)
            this.localized = message;
        if (stack) {
            this.stack = stack;
        }
        else {
            Error.captureStackTrace(this, this.constructor);
        }
    }
}
exports.default = ApiError;
