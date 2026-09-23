import Joi from "joi";

/**
 * Hard cap on how many rows a single bulk-upload request may carry.
 * Keeps one request from monopolising the DB connection pool and gives the
 * client a predictable, documented limit to chunk against.
 */
export const MAX_BULK_ROWS = 1000;

/**
 * Envelope validation for POST /student/createBulkStudents.
 *
 * NOTE: individual rows are deliberately NOT validated here. A bulk upload must
 * never fail wholesale because one spreadsheet row is malformed — the service
 * validates each row on its own and reports per-row reasons back to the caller.
 */
const bulkCreateStudents = {
  body: Joi.object().keys({
    students: Joi.array()
      .min(1)
      .max(MAX_BULK_ROWS)
      .required()
      .messages({
        "array.base": "students must be an array of student rows.",
        "array.min": "The uploaded file contains no student rows.",
        "array.max": `You can upload a maximum of ${MAX_BULK_ROWS} students at a time. Please split the file.`,
        "any.required": "students is required.",
      }),
  }),
};

// ─── Per-row schema (used inside the service, not as middleware) ──────────────

const personName = (label: string) =>
  Joi.string()
    .trim()
    .min(2)
    .max(100)
    .pattern(/^[A-Za-z][A-Za-z.'’ -]*$/)
    .messages({
      "string.base": `${label} is required.`,
      "string.empty": `${label} is required.`,
      "any.required": `${label} is required.`,
      "string.min": `${label} must be at least 2 characters.`,
      "string.max": `${label} must not exceed 100 characters.`,
      "string.pattern.base": `${label} may only contain letters, dots, apostrophes, hyphens and spaces.`,
    });

export const bulkStudentRowSchema = Joi.object({
  firstName: personName("First name").required(),
  lastName: personName("Last name").required(),
  fatherName: personName("Father's name").allow("", null).optional(),

  email: Joi.string()
    .trim()
    .lowercase()
    .email({ tlds: { allow: false } })
    .max(320)
    .required()
    .messages({
      "string.empty": "Email is required.",
      "any.required": "Email is required.",
      "string.email": "Enter a valid email address.",
      "string.max": "Email must not exceed 320 characters.",
    }),

  mobile: Joi.string()
    .trim()
    .pattern(/^[6-9]\d{9}$/)
    .required()
    .messages({
      "string.empty": "Mobile number is required.",
      "any.required": "Mobile number is required.",
      "string.pattern.base": "Enter a valid 10-digit Indian mobile number.",
    }),

  rollNumber: Joi.string().trim().max(32).required().messages({
    "string.empty": "Roll number is required.",
    "any.required": "Roll number is required.",
    "string.max": "Roll number must not exceed 32 characters.",
  }),

  className: Joi.string().trim().required().messages({
    "string.empty": "Class is required.",
    "any.required": "Class is required.",
  }),

  sectionId: Joi.string().trim().required().messages({
    "string.empty": "Section is required.",
    "any.required": "Section is required.",
  }),

  session: Joi.string().trim().required().messages({
    "string.empty": "Session is required.",
    "any.required": "Session is required.",
  }),

  gender: Joi.string()
    .trim()
    .lowercase()
    .valid("male", "female", "other")
    .required()
    .messages({
      "string.empty": "Gender is required.",
      "any.required": "Gender is required.",
      "any.only": "Gender must be Male, Female or Other.",
    }),

  dob: Joi.date().max("now").min("1900-01-01").required().messages({
    "date.base": "Enter a valid date of birth (YYYY-MM-DD).",
    "any.required": "Date of birth is required.",
    "date.max": "Date of birth cannot be in the future.",
    "date.min": "Date of birth is not a realistic date.",
  }),

  aadhar: Joi.string()
    .trim()
    .length(12)
    .pattern(/^[2-9]\d{11}$/)
    .allow("", null)
    .optional()
    .messages({
      "string.length": "Aadhar number must be exactly 12 digits.",
      "string.pattern.base": "Aadhar number must be 12 digits and cannot start with 0 or 1.",
    }),

  address: Joi.string().trim().min(10).max(300).allow("", null).optional().messages({
    "string.min": "Address must be at least 10 characters.",
    "string.max": "Address must not exceed 300 characters.",
  }),

  password: Joi.string().min(6).max(128).allow("", null).optional().messages({
    "string.min": "Password must be at least 6 characters.",
    "string.max": "Password must not exceed 128 characters.",
  }),
}).unknown(true);

/** Human labels used when reporting which spreadsheet column failed. */
export const FIELD_LABELS: Record<string, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  fatherName: "Father's Name",
  email: "Email",
  mobile: "Mobile",
  rollNumber: "Roll Number",
  className: "Class",
  sectionId: "Section",
  session: "Session",
  gender: "Gender",
  dob: "Date Of Birth",
  aadhar: "Aadhar Number",
  address: "Address",
  password: "Password",
};

export default { bulkCreateStudents };
