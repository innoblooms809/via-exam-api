"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const joi_1 = __importDefault(require("joi"));
const invalidNames = [
    "TEST",
    "NAME",
    "FATHER NAME",
    "FATHER",
    "MOTHER",
    "MOTHER NAME",
    "CANDIDATE NAME",
    "CANDIDATE",
    "KUTTA",
    "KUTTI",
    "PAGAL",
    "HARAMI",
    "HARAMKHOR",
    "ASS",
    "ASSHOLE",
    "BASTARD",
    "BLOODY",
    "BITCH",
    "FUCK",
    "SHIT",
    "CRAP",
    "BULLSHIT",
];
const nameValidation = joi_1.default.string()
    .min(2)
    .max(100)
    .regex(/^(?!.*\b(\w)\1{1,}\b)(?!.*\s{2,})[A-Z]+(?:\s[A-Z]+)*$/, "name validation")
    .invalid(...invalidNames)
    .required()
    .messages({
    "string.base": "Name should be a type of text.",
    "string.empty": "Name cannot be empty.",
    "string.min": "Name should have a minimum length of 2 characters.",
    "string.max": "Name should have a maximum length of 100 characters.",
    "string.pattern.name": `Name must be in uppercase letters, no special characters except for spaces between words, cannot start or end with a space, cannot have more than one space between words, and words cannot have two or more identical consecutive characters.`,
    "any.invalid": "Name contains invalid words.",
    "any.required": "Name is a required field.",
});
const emailValidation = joi_1.default.string().email().min(3).max(320);
const mobileValidation = joi_1.default.string()
    .pattern(/^[6-9][0-9]{9}$/)
    .messages({
    "string.pattern.base": "Mobile number must be a 10-digit number starting with 6, 7, 8, or 9",
});
const userCreateValidation = {
    body: joi_1.default.object().keys({
        companyName: joi_1.default.string().required(),
        siteLocation: joi_1.default.string().required(),
        password: joi_1.default.string().optional(),
        phoneNumber: mobileValidation,
        emailId: joi_1.default.string().email().required().min(3).max(320),
        aadharId: joi_1.default.string().optional().length(12),
        userId: joi_1.default.string().required().optional(),
        userName: joi_1.default.string().required(),
        employeeCode: joi_1.default.string().required(),
        departmentId: joi_1.default.number().required(),
        departmentName: joi_1.default.string().required(),
        designationId: joi_1.default.number().required(),
        designationName: joi_1.default.string().required(),
        userTypeId: joi_1.default.number().required(),
        userTypeName: joi_1.default.string().required(),
        dateOfBirth: joi_1.default.string().required(),
        userPhoto: joi_1.default.string().required(),
        userSignature: joi_1.default.string().required(),
        permissions: joi_1.default.array().optional()
    }),
};
exports.default = { userCreateValidation };
