"use strict";
// import jwt from "jsonwebtoken";
// import UserModel from "../modals/User.modal";
// import config from "../config/config";
// import { NextFunction, Request, Response } from "express";
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
exports.authorize = exports.authenticate = void 0;
// const authenticate = async (req: any, res: Response, next: NextFunction) => {
//   const token = req.headers.authorization?.split(" ")[1];
//   if (!token) {
//     return res.status(401).json({ message: "Authentication required" });
//   }
//   try {
//     const decodedToken: any = jwt.verify(token, config.jwt.secret);
//     const user = await UserModel.findOne({where:{userId:decodedToken?.sub.userId}});
//     if (!user) {
//       return res.status(404).json({ message: "User not found" });
//     }
//     req.user = user;
//     next();
//   } catch (error) {
//     res.status(401).json({ message: "Invalid token" });
//   }
// };
// export default authenticate;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const http_status_1 = __importDefault(require("http-status"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const config_1 = __importDefault(require("../config/config"));
const getCookieValue = (req, name) => {
    var _a, _b;
    if ((_a = req.cookies) === null || _a === void 0 ? void 0 : _a[name]) {
        return req.cookies[name];
    }
    const cookieHeader = req.headers.cookie;
    if (!cookieHeader) {
        return undefined;
    }
    return (_b = cookieHeader
        .split(";")
        .map((cookie) => cookie.trim())
        .find((cookie) => cookie.startsWith(`${name}=`))) === null || _b === void 0 ? void 0 : _b.split("=").slice(1).join("=");
};
// ─── Authenticate ─────────────────────────────────────────────────────────────
// Verifies JWT and attaches user to req.viaExamUser
// Use on every protected route
const authenticate = (req, res, next) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b;
    try {
        const authHeader = req.headers.authorization;
        const cookieToken = getCookieValue(req, "accessToken");
        if ((!authHeader || !authHeader.startsWith("Bearer ")) && !cookieToken) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Access token missing.",
            });
        }
        const token = (authHeader === null || authHeader === void 0 ? void 0 : authHeader.startsWith("Bearer "))
            ? authHeader.split(" ")[1]
            : cookieToken;
        // Verify token
        let decoded;
        try {
            decoded = jsonwebtoken_1.default.verify(token, config_1.default.jwt.secret);
        }
        catch (err) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: err.name === "TokenExpiredError"
                    ? "Token has expired. Please login again."
                    : "Invalid token.",
            });
        }
        // Extract userId — handles both { sub: "userId" } and { sub: { userId: "..." } }
        const userId = typeof decoded.sub === "object"
            ? (_a = decoded.sub) === null || _a === void 0 ? void 0 : _a.userId
            : (_b = decoded.sub) !== null && _b !== void 0 ? _b : decoded.userId;
        if (!userId) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Invalid token payload.",
            });
        }
        // Fetch fresh user with role
        const user = yield User_modal_1.default.findOne({
            include: [{ model: Role_modal_1.default, as: "role" }],
            where: { userId },
        });
        if (!user) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "User not found.",
            });
        }
        // Status checks
        if (user.status === 0) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Your account is inactive. Please contact support.",
            });
        }
        if (user.status === 2) {
            return res.status(http_status_1.default.UNAUTHORIZED).json({
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Your account has been suspended.",
            });
        }
        // Lock check
        if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
            const minutesLeft = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
            return res.status(http_status_1.default.TOO_MANY_REQUESTS).json({
                error: true,
                statusCode: http_status_1.default.TOO_MANY_REQUESTS,
                message: `Account locked. Try again in ${minutesLeft} minute(s).`,
            });
        }
        // Attach to request — using viaExamUser to avoid conflicts with your old middleware
        req.viaExamUser = user;
        next();
    }
    catch (e) {
        console.error("Authenticate error:", e.message);
        return res.status(http_status_1.default.INTERNAL_SERVER_ERROR).json({
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: "Authentication failed.",
        });
    }
});
exports.authenticate = authenticate;
// ─── Authorize ────────────────────────────────────────────────────────────────
// Call AFTER authenticate — checks if user's role is in the allowed list
// Usage: router.get("/route", authenticate, authorize(["super_admin", "admin"]), controller)
const authorize = (allowedRoles) => {
    return (req, res, next) => {
        var _a, _b;
        const userRole = (_b = (_a = req.viaExamUser) === null || _a === void 0 ? void 0 : _a.role) === null || _b === void 0 ? void 0 : _b.roleName;
        if (!userRole) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Role not found on user.",
            });
        }
        if (!allowedRoles.includes(userRole)) {
            return res.status(http_status_1.default.FORBIDDEN).json({
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: `Access denied. Allowed roles: ${allowedRoles.join(", ")}`,
            });
        }
        next();
    };
};
exports.authorize = authorize;
