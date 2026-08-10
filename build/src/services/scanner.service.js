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
Object.defineProperty(exports, "__esModule", { value: true });
const http_status_1 = __importDefault(require("http-status"));
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
// ─── UPLOAD (single or bulk) ──────────────────────────────────────────────────
const uploadSheets = (body, files, uploadedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = uploadedBy.instituteId;
        if (!instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Institute not found for this user.",
            };
        }
        if (!files || files.length === 0) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "No files provided.",
            };
        }
        const results = [];
        for (const file of files) {
            // Roll number = filename without extension (matches your frontend logic)
            const rollNo = file.originalname.replace(/\.[^.]+$/, "");
            if (!/^\d+$/.test(rollNo)) {
                results.push({ rollNo: file.originalname, status: "skipped", reason: "Filename is not a valid roll number" });
                continue;
            }
            // Check duplicate
            const existing = yield Scanner_modal_1.default.findOne({
                where: {
                    instituteId,
                    classId: body.classId,
                    section: body.section,
                    subjectId: body.subjectId,
                    examType: body.examType,
                    rollNo,
                    isDeleted: false,
                },
            });
            if (existing) {
                results.push({ rollNo, status: "duplicate", reason: "Sheet already uploaded for this student" });
                continue;
            }
            const sheetId = yield helper_1.default.generateUserId();
            yield Scanner_modal_1.default.create({
                sheetId,
                instituteId,
                classId: body.classId,
                section: body.section,
                subjectId: body.subjectId,
                examType: body.examType,
                rollNo,
                fileName: file.originalname,
                fileBuffer: file.buffer,
                fileMimeType: file.mimetype,
                fileSize: file.size,
                uploadedBy: uploadedBy.userId,
                status: "Pending",
            });
            results.push({ rollNo, status: "saved" });
        }
        const saved = results.filter((r) => r.status === "saved").length;
        const failed = results.length - saved;
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: `${saved} sheet(s) saved. ${failed} skipped/duplicate.`,
            data: { results },
        };
    }
    catch (e) {
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET ALL SHEETS (with filters) ───────────────────────────────────────────
const getAllSheets = (query, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const { classId, section, subjectId, examType, rollNo, status } = query;
        const where = { instituteId, isDeleted: false };
        if (classId)
            where.classId = classId;
        if (section)
            where.section = section;
        if (subjectId)
            where.subjectId = subjectId;
        if (examType)
            where.examType = examType;
        if (rollNo)
            where.rollNo = rollNo;
        if (status)
            where.status = status;
        // Never return fileBuffer in list — too heavy
        const sheets = yield Scanner_modal_1.default.findAll({
            where,
            attributes: { exclude: ["fileBuffer"] },
            order: [["createdAt", "DESC"]],
        });
        const sheetIds = sheets.map((s) => s.sheetId);
        const aiEvals = sheetIds.length > 0
            ? yield AIEvaluation_modal_1.default.findAll({
                where: { sheetId: sheetIds },
                attributes: ["sheetId", "totalScore", "status"],
            })
            : [];
        const evalMap = new Map();
        aiEvals.forEach((ev) => {
            evalMap.set(ev.sheetId, ev);
        });
        const enrichedSheets = sheets.map((sheet) => {
            const s = sheet.toJSON();
            const ev = evalMap.get(s.sheetId);
            if (ev) {
                if (ev.status === "Success") {
                    s.status = "Evaluated";
                    s.aiScore = ev.totalScore;
                }
                else if (ev.status === "Pending") {
                    s.status = "Evaluating";
                    s.aiScore = null;
                }
                else if (ev.status === "Failed") {
                    s.status = "Failed";
                    s.aiScore = null;
                }
            }
            return s;
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Sheets fetched successfully.",
            data: { sheets: enrichedSheets, total: enrichedSheets.length },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET SHEET FILE (stream back to client) ───────────────────────────────────
const getSheetFile = (sheetId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sheet = yield Scanner_modal_1.default.findOne({
            where: { sheetId, isDeleted: false },
        });
        if (!sheet) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Sheet not found.",
            };
        }
        if (sheet.instituteId !== requestedBy.instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Access denied.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "File fetched.",
            data: {
                buffer: sheet.fileBuffer,
                mimeType: sheet.fileMimeType,
                fileName: sheet.fileName,
            },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET SUMMARY (uploaded vs missing counts) ─────────────────────────────────
const getSheetSummary = (query, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const { classId, section, subjectId, examType } = query;
        if (!classId || !section || !subjectId || !examType) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "classId, section, subjectId and examType are required.",
            };
        }
        const sheets = yield Scanner_modal_1.default.findAll({
            where: { instituteId, classId, section, subjectId, examType, isDeleted: false },
            attributes: ["rollNo", "status", "fileName", "createdAt"],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Summary fetched.",
            data: {
                total: sheets.length,
                pending: sheets.filter((s) => s.status === "Pending").length,
                evaluated: sheets.filter((s) => s.status === "Evaluated").length,
                uploadedRollNos: sheets.map((s) => s.rollNo),
                sheets,
            },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── UPDATE STATUS ────────────────────────────────────────────────────────────
const updateSheetStatus = (sheetId, status, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const allowed = ["Pending", "Evaluated"];
        if (!allowed.includes(status)) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Status must be one of: ${allowed.join(", ")}`,
            };
        }
        const sheet = yield Scanner_modal_1.default.findOne({ where: { sheetId, isDeleted: false } });
        if (!sheet) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Sheet not found." };
        }
        if (sheet.instituteId !== requestedBy.instituteId) {
            return { error: true, statusCode: http_status_1.default.FORBIDDEN, message: "Access denied." };
        }
        yield sheet.update({ status });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Sheet status updated to ${status}.`,
            data: sheet,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── SOFT DELETE ──────────────────────────────────────────────────────────────
const deleteSheet = (sheetId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const sheet = yield Scanner_modal_1.default.findOne({ where: { sheetId, isDeleted: false } });
        if (!sheet) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Sheet not found." };
        }
        if (sheet.instituteId !== requestedBy.instituteId) {
            return { error: true, statusCode: http_status_1.default.FORBIDDEN, message: "Access denied." };
        }
        yield sheet.update({ isDeleted: true });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Sheet deleted successfully.",
            data: {},
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
exports.default = {
    uploadSheets,
    getAllSheets,
    getSheetFile,
    getSheetSummary,
    updateSheetStatus,
    deleteSheet,
};
