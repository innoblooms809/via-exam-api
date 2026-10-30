"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Kept for old imports; both helpers live in ./helper (crypto-random) now.
const helper_1 = __importDefault(require("./helper"));
exports.default = { generatePassword: helper_1.default.generatePassword, generateUserId: helper_1.default.generateUserId };
