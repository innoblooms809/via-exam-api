"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordChangeLimiter = exports.recoveryLimiter = exports.loginLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const http_status_1 = __importDefault(require("http-status"));
/**
 * Brute-force limits on sign-in, password recovery and password change. Only failed attempts
 * count (a successful sign-in costs nothing), keyed by the visitor's address *and* the account:
 * guessing one account's password is slowed, and nobody can lock everyone else out. Behind a
 * proxy, TRUST_PROXY (app.ts) makes the address the visitor's rather than the proxy's; without it
 * the limit is simply per account.
 *
 * Counted in this process's memory: with several API processes each one counts on its own.
 */
const WINDOW_MINUTES = 15;
const limitFailures = (max, key) => (0, express_rate_limit_1.default)({
    windowMs: WINDOW_MINUTES * 60 * 1000,
    max,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${key(req).trim().toLowerCase().slice(0, 320)}`,
    skip: () => process.env.NODE_ENV === 'test',
    handler: (_req, res) => res.status(http_status_1.default.TOO_MANY_REQUESTS).json({
        error: true,
        statusCode: http_status_1.default.TOO_MANY_REQUESTS,
        message: `Too many attempts. Please wait ${WINDOW_MINUTES} minutes and try again.`,
    }),
});
/** POST /login: 10 wrong passwords per account and address in 15 minutes. */
exports.loginLimiter = limitFailures(10, (req) => { var _a, _b; return String((_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.emailId) !== null && _b !== void 0 ? _b : ''); });
/** Forgot password, OTP check, reset, resend login details. */
exports.recoveryLimiter = limitFailures(10, (req) => { var _a, _b; return String((_b = (_a = req.body) === null || _a === void 0 ? void 0 : _a.email) !== null && _b !== void 0 ? _b : ''); });
/** Change password (after authenticate): wrong current passwords of a signed-in user. */
exports.passwordChangeLimiter = limitFailures(5, (req) => { var _a, _b; return String((_b = (_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.userId) !== null && _b !== void 0 ? _b : ''); });
