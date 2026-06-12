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
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Section_modal_1 = __importDefault(require("../modals/Section.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const Session_modal_1 = __importDefault(require("../modals/Session.modal"));
const Notification_modal_1 = __importDefault(require("../modals/Notification.modal"));
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const Scanner_modal_1 = __importDefault(require("../modals/Scanner.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const sequelize_1 = require("sequelize");
// ─── CREATE EXAM ──────────────────────────────────────────────────────────────
const createExam = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Get instituteId from logged in admin/examiner
        const instituteId = createdBy.instituteId;
        if (!instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Institute not found for this user.",
            };
        }
        // 2. Validate teacher belongs to same institute
        const teacherRole = yield Role_modal_1.default.findOne({ where: { role: "TEACHER" } });
        const teacher = yield User_modal_1.default.findOne({
            where: {
                userId: body.teacherId,
                instituteId,
                roleId: teacherRole === null || teacherRole === void 0 ? void 0 : teacherRole.id,
                status: 1,
            },
        });
        if (!teacher) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher not found in your institute.",
            };
        }
        // 3. Check duplicate exam
        const duplicate = yield Exam_modal_1.default.findOne({
            where: {
                instituteId,
                sessionId: body.sessionId,
                examType: body.examType,
                subjectId: body.subjectId,
                isDeleted: false,
            },
        });
        if (duplicate) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "An exam with same session, type, class and subject already exists.",
            };
        }
        // 4. Generate exam ID
        const examId = yield helper_1.default.generateUserId();
        // 5. Create exam
        const exam = yield Exam_modal_1.default.create({
            examId,
            instituteId,
            sessionId: body.sessionId,
            examType: body.examType,
            classId: body.classId,
            subjectId: body.subjectId,
            teacherId: teacher.userId,
            examinerId: createdBy.userId,
            totalMarks: Number(body.totalMarks),
            passingMarks: Number(body.passingMarks),
            duration: body.duration ? Number(body.duration) : null,
            instructions: body.instructions || null,
            status: "Draft",
        });
        // 6. Send notification to assigned teacher
        const notificationId = yield helper_1.default.generateUserId();
        yield Notification_modal_1.default.create({
            notificationId,
            instituteId,
            userId: teacher.userId,
            type: "EXAM_ASSIGNED",
            title: "New Exam Assigned",
            message: `A ${body.examType} exam has been assigned to you.`,
            referenceId: examId,
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Exam created successfully.",
            data: exam,
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
// ─── GET ALL EXAMS ────────────────────────────────────────────────────────────
const getAllExams = (query, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const { search = "", status = "", classVal = "" } = query;
        const where = { instituteId, isDeleted: false };
        if (status)
            where.status = status;
        if (classVal)
            where.classVal = classVal;
        if (search) {
            where[sequelize_1.Op.or] = [
                { examType: { [sequelize_1.Op.iLike]: `%${search}%` } },
                { subject: { [sequelize_1.Op.iLike]: `%${search}%` } },
                { classVal: { [sequelize_1.Op.iLike]: `%${search}%` } },
            ];
        }
        const exams = yield Exam_modal_1.default.findAll({
            where,
            include: [
                { model: Class_modal_1.default, as: "class", where: { isDeleted: false }, required: true },
                { model: Subject_modal_1.default, as: "subject", where: { isDeleted: false }, required: true },
                { model: User_modal_1.default, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
            order: [["createdAt", "DESC"]],
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exams fetched successfully.",
            data: { exams, total: exams.length },
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
// ─── GET ASSIGNED EXAMS (FOR TEACHER) ─────────────────────────────────────────
const getAssignedExams = (requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const teacherId = requestedBy.userId;
        const exams = yield Exam_modal_1.default.findAll({
            where: {
                instituteId,
                isDeleted: false,
                teacherId
            },
            include: [
                { model: Class_modal_1.default, as: "class", attributes: ["className"], where: { isDeleted: false }, required: true },
                { model: Section_modal_1.default, as: "section", attributes: ["sectionName"], required: false },
                { model: Subject_modal_1.default, as: "subject", attributes: ["subjectName"], where: { isDeleted: false }, required: true },
                { model: Session_modal_1.default, as: "session", attributes: ["sessionName"] },
            ],
            order: [["createdAt", "DESC"]],
        });
        const formattedExams = yield Promise.all(exams.map((exam) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f, _g, _h;
            const totalStudents = yield Student_modal_1.default.count({
                where: { instituteId, classId: exam.classId, isActive: true }
            });
            const uploadedSheets = yield Scanner_modal_1.default.count({
                where: {
                    instituteId,
                    classId: exam.classId,
                    subjectId: exam.subjectId,
                    examType: exam.examType,
                    isDeleted: false
                }
            });
            return {
                id: exam.examId,
                classId: ((_a = exam.class) === null || _a === void 0 ? void 0 : _a.classId) || exam.classId,
                className: ((_b = exam.class) === null || _b === void 0 ? void 0 : _b.className) || "N/A",
                sectionId: ((_c = exam.section) === null || _c === void 0 ? void 0 : _c.sectionId) || exam.sectionId,
                sectionName: ((_d = exam.section) === null || _d === void 0 ? void 0 : _d.sectionName) || "N/A",
                subjectId: ((_e = exam.subject) === null || _e === void 0 ? void 0 : _e.subjectId) || exam.subjectId,
                subjectName: ((_f = exam.subject) === null || _f === void 0 ? void 0 : _f.subjectName) || "N/A",
                sessionId: ((_g = exam.session) === null || _g === void 0 ? void 0 : _g.sessionId) || exam.sessionId,
                sessionName: ((_h = exam.session) === null || _h === void 0 ? void 0 : _h.sessionName) || "N/A",
                examType: exam.examType,
                status: exam.status,
                totalStudents,
                uploadedSheets
            };
        })));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Assigned exams fetched successfully.",
            data: { exams: formattedExams },
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
// ─── GET ONE EXAM ─────────────────────────────────────────────────────────────
const getExamById = (examId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exam = yield Exam_modal_1.default.findOne({
            where: { examId, isDeleted: false },
            include: [
                { model: Class_modal_1.default, as: "class", where: { isDeleted: false }, required: true },
                { model: Subject_modal_1.default, as: "subject", where: { isDeleted: false }, required: true },
                { model: User_modal_1.default, as: "teacher", attributes: ["userId", "userName", "emailId"], required: false },
            ],
        });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        // Check institute access
        if (requestedBy.instituteId !== exam.instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Access denied.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam fetched successfully.",
            data: exam,
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
// ─── UPDATE EXAM STATUS ───────────────────────────────────────────────────────
const updateExamStatus = (examId, status, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const allowed = ["Draft", "Live", "Completed"];
        if (!allowed.includes(status)) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Status must be one of: ${allowed.join(", ")}`,
            };
        }
        const exam = yield Exam_modal_1.default.findOne({ where: { examId, isDeleted: false } });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        if (requestedBy.instituteId !== exam.instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Access denied.",
            };
        }
        yield exam.update({ status });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Exam status updated to ${status}.`,
            data: exam,
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
// ─── UPDATE EXAM  ───────────────────────────────────────────────────────
const updateExam = (examId, body, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const exam = yield Exam_modal_1.default.findOne({
            where: {
                examId,
                instituteId,
                isDeleted: false,
            },
        });
        if (!exam) {
            return {
                error: true,
                statusCode: 404,
                message: "Exam not found",
            };
        }
        // Optional Rule
        if (exam.status === "Completed") {
            return {
                error: true,
                statusCode: 400,
                message: "Completed exam cannot be updated",
            };
        }
        // Status Validation
        if (body.status) {
            const allowedStatus = ["Draft", "Live", "Completed"];
            if (!allowedStatus.includes(body.status)) {
                return {
                    error: true,
                    statusCode: 400,
                    message: "Status must be one of: Draft, Live, Completed",
                };
            }
        }
        yield exam.update({
            sessionId: body.session || exam.sessionId,
            examType: body.examType || exam.examType,
            subjectId: body.subject || exam.subjectId,
            totalMarks: body.totalMarks || exam.totalMarks,
            passingMarks: body.passingMarks || exam.passingMarks,
            duration: body.duration || exam.duration,
            instructions: body.instructions || exam.instructions,
            status: body.status || exam.status,
        });
        return {
            error: false,
            statusCode: 200,
            message: "Exam updated successfully",
            data: exam,
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: 500,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── SOFT DELETE EXAM ─────────────────────────────────────────────────────────
const deleteExam = (examId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exam = yield Exam_modal_1.default.findOne({ where: { examId, isDeleted: false } });
        if (!exam) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        if (requestedBy.instituteId !== exam.instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.FORBIDDEN,
                message: "Access denied.",
            };
        }
        yield exam.update({ isDeleted: true });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam deleted successfully.",
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
// ─── GET EXAM PROGRESS ────────────────────────────────────────────────────────
const getExamProgress = (examId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const exam = yield Exam_modal_1.default.findOne({
            where: { examId, instituteId, isDeleted: false },
            include: [
                { model: Class_modal_1.default, as: "class", attributes: ["classId", "className"], required: true },
                { model: Subject_modal_1.default, as: "subject", attributes: ["subjectId", "subjectName"], required: true },
                { model: Session_modal_1.default, as: "session", attributes: ["sessionName"] }
            ]
        });
        if (!exam) {
            return { error: true, statusCode: http_status_1.default.NOT_FOUND, message: "Exam not found." };
        }
        const sections = yield Section_modal_1.default.findAll({
            where: { classId: exam.classId, isDeleted: false }
        });
        const progressData = yield Promise.all(sections.map((sec) => __awaiter(void 0, void 0, void 0, function* () {
            const totalStudents = yield Student_modal_1.default.count({
                where: { instituteId, classId: exam.classId, sectionId: sec.sectionId, isActive: true }
            });
            // Some sheets might be tracked by sectionName instead of ID, we check sectionId or sectionName.
            const uploadedSheets = yield Scanner_modal_1.default.count({
                where: {
                    instituteId,
                    classId: exam.classId,
                    section: { [sequelize_1.Op.in]: [sec.sectionId, sec.sectionName] },
                    subjectId: exam.subjectId,
                    examType: exam.examType,
                    isDeleted: false
                }
            });
            return {
                sectionId: sec.sectionId,
                sectionName: sec.sectionName,
                totalStudents,
                uploadedSheets
            };
        })));
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Progress fetched successfully.",
            data: { progress: progressData }
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
    getExamProgress,
    createExam,
    getAllExams,
    getExamById,
    updateExamStatus,
    updateExam,
    deleteExam,
    getAssignedExams,
};
