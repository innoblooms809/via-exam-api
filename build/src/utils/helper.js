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
const uuid_1 = require("uuid");
const generatePassword = () => __awaiter(void 0, void 0, void 0, function* () {
    const randomNum = Math.floor(Math.random() * 10000);
    const prefix = 'RSP';
    const timestamp = Date.now().toString().slice(-6);
    const randomNumStr = randomNum.toString().padStart(4, '0');
    const id = prefix + timestamp + randomNumStr;
    return id.length === 10 ? id : id.slice(0, 10);
});
const generateUserId = () => __awaiter(void 0, void 0, void 0, function* () {
    const randomNum = Math.floor(Math.random() * 10000);
    const prefix = 'IB';
    const timestamp = Date.now().toString().slice(-4);
    const randomNumStr = randomNum.toString().padStart(4, '0');
    const id = prefix + timestamp + randomNumStr;
    return id.length === 8 ? id : id.slice(0, 8);
});
const generateCustomerId = (name) => __awaiter(void 0, void 0, void 0, function* () {
    const uuid = (0, uuid_1.v4)().replace(/-/g, '');
    const p1 = name[0].toUpperCase();
    const p2 = name[name.length - 1].toUpperCase();
    const customerId = `${p1}${p2}${uuid}`.slice(0, 12);
    return customerId.toUpperCase();
});
const generateEnquiryId = (productName, productCategory) => __awaiter(void 0, void 0, void 0, function* () {
    const uuid = (0, uuid_1.v4)().replace(/-/g, '');
    const p1 = productName.toUpperCase().slice(0, 2);
    const p2 = productCategory.toUpperCase().slice(0, 2);
    const id = `${p1}-${p2}-${uuid}`.slice(0, 14);
    return id.toUpperCase();
});
exports.default = { generatePassword, generateUserId, generateCustomerId, generateEnquiryId };
