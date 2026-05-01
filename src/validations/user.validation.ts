import Joi from "joi";
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
const nameValidation = Joi.string()
  .min(2)
  .max(100)
  .regex(
    /^(?!.*\b(\w)\1{1,}\b)(?!.*\s{2,})[A-Z]+(?:\s[A-Z]+)*$/,
    "name validation"
  )
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

const emailValidation = Joi.string().email().min(3).max(320);
const mobileValidation = Joi.string()
  .pattern(/^[6-9][0-9]{9}$/)
  .messages({
    "string.pattern.base":
      "Mobile number must be a 10-digit number starting with 6, 7, 8, or 9",
  });
const userCreateValidation = {
  body: Joi.object().keys({
    companyName: Joi.string().required(),
    siteLocation: Joi.string().required(),
    password: Joi.string().optional(),
    phoneNumber: mobileValidation,
    emailId: Joi.string().email().required().min(3).max(320),
    aadharId: Joi.string().optional().length(12),
    userId: Joi.string().required().optional(),
    userName: Joi.string().required(),
    employeeCode: Joi.string().required(),
    departmentId: Joi.number().required(),
    departmentName: Joi.string().required(),
    designationId: Joi.number().required(),
    designationName: Joi.string().required(),
    userTypeId: Joi.number().required(),
    userTypeName: Joi.string().required(),
    dateOfBirth: Joi.string().required(),
    userPhoto: Joi.string().required(), // Base64 string
    userSignature: Joi.string().required(), // Base64 string
    permissions:Joi.array().optional()
  }),
};

export default { userCreateValidation };
