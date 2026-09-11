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
const sequelize_1 = require("sequelize");
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const AIEvaluation_modal_1 = __importDefault(require("../modals/AIEvaluation.modal"));
const QuestionPaper_modal_1 = __importDefault(require("../modals/question-paper/QuestionPaper.modal"));
const stander_answer_model_1 = __importDefault(require("../modals/question-paper/stander-answer.model"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const Session_modal_1 = __importDefault(require("../modals/Session.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
// Exam-table statuses reached only after the QP + answer key pair is approved.
const APPROVED_EXAM_STATUSES = ["Approved", "Live", "Completed"];
const APPROVED_PAPER_STATUSES = ["APPROVED", "PUBLISHED"];
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
// ─── APPROVAL WORKFLOW SCANNER ENDPOINTS ────────────────────────────────────
// Get approved exams for scanner to upload student answer papers
const getApprovedExams = (requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        if (!instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Institute ID not found for user.",
                data: { exams: [] },
            };
        }
        // Only this institute's exams are candidates — everything below is scoped through these IDs.
        const instituteExams = yield Exam_modal_1.default.findAll({
            where: { instituteId, isDeleted: false },
            order: [["createdAt", "DESC"]],
        });
        const empty = {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "No approved exams found.",
            data: { exams: [] },
        };
        if (instituteExams.length === 0)
            return empty;
        const instituteExamIds = instituteExams.map((e) => e.examId);
        const questionPapers = yield QuestionPaper_modal_1.default.findAll({
            where: { examId: { [sequelize_1.Op.in]: instituteExamIds }, status: { [sequelize_1.Op.in]: APPROVED_PAPER_STATUSES } },
            attributes: ["paperId", "examId", "paperSet", "status", "approvedAt"],
        });
        const approvedPaperIds = questionPapers.map((qp) => qp.paperId);
        // Answer keys are linked to the exam either directly or through their question paper.
        const answerKeys = yield stander_answer_model_1.default.findAll({
            where: {
                status: { [sequelize_1.Op.in]: APPROVED_PAPER_STATUSES },
                [sequelize_1.Op.or]: [
                    { examId: { [sequelize_1.Op.in]: instituteExamIds } },
                    ...(approvedPaperIds.length > 0 ? [{ paperId: { [sequelize_1.Op.in]: approvedPaperIds } }] : []),
                ],
            },
            attributes: ["paperId", "examId", "paperSet", "status", "approvedAt"],
        });
        // Same rule as the approval workflow: the exam is approved once both its
        // question paper and answer key are approved (or the exam itself says so).
        const approved = instituteExams
            .map((exam) => {
            const qp = questionPapers.find((p) => p.examId === exam.examId);
            const ans = answerKeys.find((a) => a.examId === exam.examId || (qp && a.paperId === qp.paperId));
            const isApproved = APPROVED_EXAM_STATUSES.includes(exam.status) ||
                (exam.status !== "Rejected" && Boolean(qp && ans));
            return isApproved ? { exam, qp, ans } : null;
        })
            .filter(Boolean);
        if (approved.length === 0)
            return empty;
        const exams = approved.map((a) => a.exam);
        const unique = (ids) => Array.from(new Set(ids.filter(Boolean)));
        const approvedExamIds = exams.map((e) => e.examId);
        const classIds = unique(exams.map((e) => e.classId));
        const subjectIds = unique(exams.map((e) => e.subjectId));
        const sessionIds = unique(exams.map((e) => e.sessionId));
        const userIds = unique(exams.flatMap((e) => [e.teacherId, e.examinerId]));
        const [classesList, subjectsList, sessionsList, usersList, uploadCounts, studentCounts] = yield Promise.all([
            classIds.length ? Class_modal_1.default.findAll({ where: { classId: { [sequelize_1.Op.in]: classIds } } }) : [],
            subjectIds.length ? Subject_modal_1.default.findAll({ where: { subjectId: { [sequelize_1.Op.in]: subjectIds } } }) : [],
            sessionIds.length ? Session_modal_1.default.findAll({ where: { sessionId: { [sequelize_1.Op.in]: sessionIds } } }) : [],
            userIds.length
                ? User_modal_1.default.findAll({
                    where: { userId: { [sequelize_1.Op.in]: userIds }, instituteId },
                    attributes: ["userId", "userName"],
                })
                : [],
            Scanner_modal_1.default.count({
                where: { instituteId, examId: { [sequelize_1.Op.in]: approvedExamIds }, isDeleted: false },
                group: ["examId"],
            }),
            classIds.length
                ? Student_modal_1.default.count({
                    where: { instituteId, classId: { [sequelize_1.Op.in]: classIds } },
                    group: ["classId"],
                })
                : [],
        ]);
        const classMap = new Map(classesList.map((c) => [c.classId, c.className]));
        const subjectMap = new Map(subjectsList.map((s) => [s.subjectId, s]));
        const sessionMap = new Map(sessionsList.map((s) => [s.sessionId, s.sessionName]));
        const userMap = new Map(usersList.map((u) => [u.userId, u.userName]));
        const uploadMap = new Map(uploadCounts.map((r) => [r.examId, Number(r.count)]));
        const studentMap = new Map(studentCounts.map((r) => [r.classId, Number(r.count)]));
        const enrichedExams = approved.map(({ exam, qp, ans }) => {
            const subject = subjectMap.get(exam.subjectId);
            return {
                examId: exam.examId,
                examName: exam.examType,
                examType: exam.examType,
                classId: exam.classId,
                className: exam.classId ? classMap.get(exam.classId) || exam.classId : "All Classes",
                subjectId: exam.subjectId,
                subject: (subject === null || subject === void 0 ? void 0 : subject.subjectName) || exam.subjectId,
                subjectCode: (subject === null || subject === void 0 ? void 0 : subject.subjectCode) || "",
                sessionId: exam.sessionId,
                session: sessionMap.get(exam.sessionId) || exam.sessionId,
                teacherName: userMap.get(exam.teacherId) || "",
                examinerName: exam.examinerId ? userMap.get(exam.examinerId) || "" : "",
                setLabel: (qp === null || qp === void 0 ? void 0 : qp.paperSet) || (ans === null || ans === void 0 ? void 0 : ans.paperSet) || "",
                totalMarks: exam.totalMarks,
                passingMarks: exam.passingMarks,
                duration: exam.duration,
                instructions: exam.instructions,
                totalStudents: exam.classId ? studentMap.get(exam.classId) || 0 : 0,
                uploadedCount: uploadMap.get(exam.examId) || 0,
                status: exam.status,
                questionPaperStatus: (qp === null || qp === void 0 ? void 0 : qp.status) || null,
                answerKeyStatus: (ans === null || ans === void 0 ? void 0 : ans.status) || null,
                approvedAt: (qp === null || qp === void 0 ? void 0 : qp.approvedAt) || (ans === null || ans === void 0 ? void 0 : ans.approvedAt) || exam.updatedAt,
                createdAt: exam.createdAt,
            };
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Approved exams fetched successfully.",
            data: { exams: enrichedExams },
        };
    }
    catch (e) {
        console.error("getApprovedExams Error:", e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
            data: { exams: [] },
        };
    }
});
// Upload single student answer paper for approval workflow
const uploadStudentAnswerPaper = (body, file, uploadedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = uploadedBy.instituteId;
        if (!file) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "No file provided.",
            };
        }
        if (!body.examId || !body.studentName || !body.rollNumber) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "examId, studentName, and rollNumber are required.",
            };
        }
        // Check if exam exists
        const exam = yield Exam_modal_1.default.findOne({
            where: { examId: body.examId, instituteId, isDeleted: false },
        });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        const classId = body.classId || exam.classId || "ALL";
        const section = body.section || "A";
        // Check duplicate
        const existing = yield Scanner_modal_1.default.findOne({
            where: {
                instituteId,
                examId: body.examId,
                rollNo: body.rollNumber,
                isDeleted: false,
            },
        });
        if (existing) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Answer paper already uploaded for this student.",
            };
        }
        const sheetId = yield helper_1.default.generateUserId();
        yield Scanner_modal_1.default.create({
            sheetId,
            instituteId,
            examId: body.examId,
            classId,
            section,
            subjectId: exam.subjectId,
            examType: exam.examType,
            rollNo: body.rollNumber,
            studentName: body.studentName,
            fileName: file.originalname,
            fileBuffer: file.buffer,
            fileMimeType: file.mimetype,
            fileSize: file.size,
            uploadedBy: uploadedBy.userId,
            status: "UPLOADED",
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Student answer paper uploaded successfully.",
            data: { sheetId },
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
// Get student answer papers for a specific exam
const getStudentAnswerPapers = (examId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const papers = yield Scanner_modal_1.default.findAll({
            where: { examId, instituteId, isDeleted: false },
            attributes: { exclude: ["fileBuffer"] },
            order: [["createdAt", "DESC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student answer papers fetched successfully.",
            data: { answerPapers: papers },
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
    getApprovedExams,
    uploadStudentAnswerPaper,
    getStudentAnswerPapers,
};
