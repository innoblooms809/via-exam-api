import Joi from "joi";
import { normalizeKeyText, normalizeRollNo } from "../utils/textRules";

/**
 * Requests of the answer-sheet routes (routes/v1/scanner/scanner.route.ts).
 *
 * Section and exam type names can be Arabic ("أ", "نصفي") and older ids aren't all alike, so
 * text is only checked for length and control characters, then stored and looked up in one
 * form: one Unicode encoding (NFC), no direction marks. A roll number typed on an Arabic,
 * Persian or Indian keyboard is read as 0-9. Whether a value names a real class, exam or
 * student is the service's to say. Sheet ids are the API's own, so they are checked exactly.
 *
 * Every message is an English key, translated into the request's language (middlewares/validate.ts).
 */

/** No control characters (tabs, line breaks, NUL…): never part of a name or an id. */
const NO_CONTROL_CHARS = /^[^\p{Cc}]*$/u;

/** A sheet id as the API makes them ("VISHT…", or the older "IB…"). */
const SHEET_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A picked value (class, section, subject, exam): its encoding unified, then length and characters checked. */
const picked = (max: number, invalid: string) =>
  Joi.string()
    .allow("", null)
    .custom((value: string) => normalizeKeyText(value))
    .max(max)
    .pattern(NO_CONTROL_CHARS)
    .messages({ "string.base": invalid, "string.max": invalid, "string.pattern.base": invalid });

const classId = picked(100, "The class isn't valid. Pick it again.");
const section = picked(100, "The section isn't valid. Pick it again.");
const subjectId = picked(100, "The subject isn't valid. Pick it again.");
const examType = picked(100, "The exam type isn't valid. Pick it again.");
const examId = picked(100, "The exam isn't valid. Pick it again.");

const flag = Joi.alternatives()
  .try(Joi.boolean(), Joi.string().valid("true", "false", "1", "0", ""), Joi.number().valid(0, 1))
  .messages({ "alternatives.match": "Replace must be true or false." });

const rollNo = Joi.string()
  .allow("", null)
  .custom((value: string) => normalizeRollNo(value))
  .max(32)
  .messages({
    "string.base": "Roll number must not exceed 32 characters.",
    "string.max": "Roll number must not exceed 32 characters.",
  });

const sheetParams = Joi.object({
  sheetId: Joi.string().trim().pattern(SHEET_ID).required().messages({
    "string.base": "This sheet link isn't valid.",
    "string.empty": "This sheet link isn't valid.",
    "string.pattern.base": "This sheet link isn't valid.",
    "any.required": "This sheet link isn't valid.",
  }),
});

/** POST /scanner/uploadSheets (multipart: checked after multer has read the fields). */
const uploadSheets = {
  body: Joi.object({ classId, section, sectionId: section, subjectId, examType, examId, replace: flag, overwrite: flag }).unknown(true),
};

/** PUT /scanner/replaceSheet/:sheetId, DELETE /scanner/deleteSheet/:sheetId, GET /scanner/getFile/:sheetId */
const sheetById = { params: sheetParams };

/** GET /scanner/getAllSheets (and the cache-busting _t the UI adds); a page at a time: ?page=&limit= */
const getAllSheets = {
  query: Joi.object({
    classId,
    section,
    subjectId,
    examType,
    examId,
    rollNo,
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(500),
  }).unknown(true),
};

export default { uploadSheets, sheetById, getAllSheets, };
