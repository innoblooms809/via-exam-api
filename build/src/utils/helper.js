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
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const uuid_1 = require("uuid");
const idGenerator_1 = require("./idGenerator");
// Passwords are drawn from crypto.randomInt. The old generator was "RSP" + the
// clock's last six digits + four random digits, so anyone who knew roughly when
// an account was created could guess its first password.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SPECIAL = "@#$!";
const pick = (chars) => chars[(0, crypto_1.randomInt)(chars.length)];
const shuffle = (chars) => {
    for (let i = chars.length - 1; i > 0; i--) {
        const j = (0, crypto_1.randomInt)(i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars;
};
const strongPassword = (length) => {
    const all = UPPER + LOWER + DIGITS + SPECIAL;
    // At least one of each class, the rest from the whole set, then shuffled.
    const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SPECIAL)];
    while (chars.length < length)
        chars.push(pick(all));
    return shuffle(chars).join("");
};
/** Initial password for a new account (emailed to the user). */
const generatePassword = () => __awaiter(void 0, void 0, void 0, function* () { return strongPassword(12); });
/** Temporary password for credential resets, e.g. aB3$xK9!mQ2p */
const generateTempPassword = () => strongPassword(12);
/** @deprecated use newId(kind) from utils/idGenerator — kept for old callers. */
const generateUserId = () => __awaiter(void 0, void 0, void 0, function* () { return (0, idGenerator_1.newId)("user"); });
const generateCustomerId = (name) => __awaiter(void 0, void 0, void 0, function* () {
    const uuid = (0, uuid_1.v4)().replace(/-/g, "");
    const p1 = name[0].toUpperCase();
    const p2 = name[name.length - 1].toUpperCase();
    return `${p1}${p2}${uuid}`.slice(0, 12).toUpperCase();
});
const generateEnquiryId = (productName, productCategory) => __awaiter(void 0, void 0, void 0, function* () {
    const uuid = (0, uuid_1.v4)().replace(/-/g, "");
    const p1 = productName.toUpperCase().slice(0, 2);
    const p2 = productCategory.toUpperCase().slice(0, 2);
    return `${p1}-${p2}-${uuid}`.slice(0, 14).toUpperCase();
});
exports.default = { generatePassword, generateUserId, generateCustomerId, generateEnquiryId, generateTempPassword };
