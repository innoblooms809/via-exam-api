"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.student = exports.user = void 0;
var user_validation_1 = require("./user.validation");
Object.defineProperty(exports, "user", { enumerable: true, get: function () { return __importDefault(user_validation_1).default; } });
var student_validation_1 = require("./student.validation");
Object.defineProperty(exports, "student", { enumerable: true, get: function () { return __importDefault(student_validation_1).default; } });
