import httpStatus from "http-status";
import Scanner from "../../models/Scanner.model";
import AIEvaluation from "../../models/AIEvaluation.model";
import RegHelper from "../../utils/helper";
import { isScannerRequester, isTeacherRequester, requireSheetAccess, scopeSheetRows } from "../evaluation/evaluationAccess.service";
import AnswerSheetStorage from "../answer-sheet/answerSheetStorage.service";
import logger from "../../config/logger";
import { normalizeKeyText, normalizeRollNo } from "../../utils/textRules";
import { pageInfo, paging } from "../../utils/pagination";

/** A failure the caller can't act on: logged here, a plain message for them (no internal error text). */
const somethingWentWrong = (where: string, e: any, data?: object) => {
  logger.error(`[Scanner] ${where} failed: ${e?.stack || e?.message || e}`);
  return {
    error: true,
    statusCode: httpStatus.INTERNAL_SERVER_ERROR,
    message: "Something went wrong. Please try again.",
    ...(data ? { data } : {}),
  };
};

// ─── UPLOAD (single or bulk) ──────────────────────────────────────────────────
// Storage lives in answerSheetStorage.service.ts: scans are stored as files
// (uploads/private/answer-sheets/) rather than a Postgres BLOB, and keeping the
// row, the stored file and the temp file in step needs its own module.
const uploadSheets = AnswerSheetStorage.uploadSheets;

// ─── REPLACE ONE SHEET ────────────────────────────────────────────────────────
const replaceSheet = AnswerSheetStorage.replaceSheet;

/** Sheet statuses that come from evaluation, hidden from scanner staff. */
const SCANNER_HIDDEN_STATUSES = new Set(["Evaluated", "Evaluating", "Failed"]);

// ─── LIST SHEETS ──────────────────────────────────────────────────────────────
// The sheets of one exam (examId, or class + subject + exam type, optionally a section) or
// one sheet (sheetId), a page at a time: ?page=&limit= (50 a page, at most 500; the first
// 500 without them). Each row carries its AI status and score (not for scanner staff).

const SHEET_PAGING = { defaultLimit: 50, maxLimit: 500, unpagedLimit: 500 };
/** Not sent in a list: the scan itself and its storage links (encrypted at rest, decrypted per row). Opening a sheet uses getFile. */
const SHEET_LIST_EXCLUDE = ["fileBuffer", "fileUrl", "filePublicId"];

const getAllSheets = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const { classId, section, subjectId, examType, rollNo, status, sheetId, examId } = query;

    // Names as stored (one encoding, no direction marks); a roll number typed in any script is 0-9.
    const where: any = { instituteId, isDeleted: false };
    if (classId) where.classId = normalizeKeyText(classId);
    if (section) where.section = normalizeKeyText(section);
    if (subjectId) where.subjectId = normalizeKeyText(subjectId);
    if (examType) where.examType = normalizeKeyText(examType);
    if (rollNo) where.rollNo = normalizeRollNo(rollNo);
    if (status) where.status = status;
    if (sheetId) where.sheetId = sheetId;
    if (examId) where.examId = examId;

    // One exam (or one sheet) at a time: without it the list would be every sheet of the
    // school, every class × every exam of every session.
    if (!sheetId && !examId && !(classId && subjectId && examType)) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Choose the exam whose answer sheets to list (examId, or class, subject and exam type).",
      };
    }

    const { page, limit, offset } = paging(query, SHEET_PAGING);
    const scanner = isScannerRequester(requestedBy);
    // createdAt ties within a bulk upload; the id keeps every page in the same order.
    const order: any = [["createdAt", "DESC"], ["id", "DESC"]];

    let pageRows: any[];
    let total: number;
    if (isTeacherRequester(requestedBy)) {
      // A teacher's access is decided sheet by sheet (subject, assigned exam and section,
      // rechecks, cross-checks), so the exam's sheets are scoped first and the page cut after.
      const rows = await Scanner.findAll({ where, attributes: { exclude: SHEET_LIST_EXCLUDE }, order });
      let visible = await scopeSheetRows(requestedBy, rows.map((s: any) => s.toJSON()));
      // Looking a sheet up by real roll number would reveal a masked student.
      if (rollNo) visible = visible.filter((s: any) => !s.identityMasked);
      total = visible.length;
      pageRows = visible.slice(offset, offset + limit);
    } else {
      const { rows, count } = await Scanner.findAndCountAll({ where, attributes: { exclude: SHEET_LIST_EXCLUDE }, order, limit, offset });
      total = count;
      // Scanner staff: names masked, roll numbers kept. Admins: as stored.
      pageRows = await scopeSheetRows(requestedBy, rows.map((s: any) => s.toJSON()));
    }

    const sheetIds = pageRows.map((s: any) => s.sheetId);
    // Scanner staff never see evaluation: their sheets carry no AI status or score.
    const aiEvals =
      sheetIds.length > 0 && !scanner
        ? await AIEvaluation.findAll({
          where: { sheetId: sheetIds },
          attributes: ["sheetId", "totalScore", "status"],
        })
        : [];

    const evalMap = new Map<string, any>();
    aiEvals.forEach((ev: any) => {
      evalMap.set(ev.sheetId, ev);
    });

    const sheets = pageRows.map((row: any) => {
      // The list shows the scan's flag and reasons; the per-page measurements stay with the sheet.
      const s = { ...row, qualityReport: row.qualityReport ? { reasons: row.qualityReport.reasons ?? [] } : null };
      if (scanner) {
        // A status the evaluation set reads as plain "uploaded" to them.
        if (SCANNER_HIDDEN_STATUSES.has(String(s.status))) s.status = "Uploaded";
        return s;
      }
      const ev = evalMap.get(s.sheetId);
      if (ev) {
        if (ev.status === "Success") {
          s.status = "Evaluated";
          s.aiScore = ev.totalScore;
        } else if (ev.status === "Pending") {
          s.status = "Evaluating";
          s.aiScore = null;
        } else if (ev.status === "Failed") {
          s.status = "Failed";
          s.aiScore = null;
        }
      }
      return s;
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sheets fetched successfully.",
      data: { sheets, total, pagination: pageInfo(total, page, limit) },
    };
  } catch (e: any) {
    return somethingWentWrong("List sheets", e);
  }
};

// ─── GET SHEET FILE (stream back to client) ───────────────────────────────────

const getSheetFile = AnswerSheetStorage.getSheetFile;

// ─── SOFT DELETE ──────────────────────────────────────────────────────────────

// Soft-deletes the row and destroys the stored scan once the change commits.
const deleteSheet = AnswerSheetStorage.deleteSheet;

export default {
  uploadSheets,
  replaceSheet,
  getAllSheets,
  getSheetFile,
  deleteSheet,
};
