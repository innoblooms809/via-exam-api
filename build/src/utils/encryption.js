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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const config_1 = __importDefault(require("../config/config"));
// Passwords are hashed (one-way) with bcrypt, never encrypted: nobody, not even the server, can
// read them back. Columns the app must read back are encrypted by utils/dataProtection.ts.
//
// Cost factor of new hashes: 10 by default (OWASP's minimum for bcrypt), BCRYPT_ROUNDS to change it
// (ENC_SECRET_KEY, its old name, still works). Each step doubles the work, and bcryptjs runs on
// the API's main thread: 10 takes about 0.1 s per sign-in here, 12 about 0.4 s.
const MIN_ROUNDS = config_1.default.env === 'test' ? 4 : 10;
const configuredRounds = Number((_a = process.env.BCRYPT_ROUNDS) !== null && _a !== void 0 ? _a : process.env.ENC_SECRET_KEY);
const PASSWORD_ROUNDS = Number.isInteger(configuredRounds) ? Math.min(15, Math.max(MIN_ROUNDS, configuredRounds)) : Math.max(MIN_ROUNDS, 10);
const encryptPassword = (password) => __awaiter(void 0, void 0, void 0, function* () {
    const encryptedPassword = yield bcryptjs_1.default.hash(password, PASSWORD_ROUNDS);
    return encryptedPassword;
});
const isPasswordMatch = (password, userPassword) => __awaiter(void 0, void 0, void 0, function* () {
    return bcryptjs_1.default.compare(password, userPassword);
});
/** True for a hash made with a lower cost than new ones get (rehash it at the next sign-in). */
const passwordNeedsRehash = (hash) => {
    if (!hash)
        return false;
    try {
        return bcryptjs_1.default.getRounds(hash) < PASSWORD_ROUNDS;
    }
    catch (_a) {
        return false;
    }
};
exports.default = { encryptPassword, isPasswordMatch, passwordNeedsRehash };
