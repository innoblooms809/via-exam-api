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
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Exam_modal_1 = __importDefault(require("../modals/Exam.modal"));
const Session_modal_1 = __importDefault(require("../modals/Session.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const helper_1 = __importDefault(require("../utils/helper"));
const ACTIVE_USER_STATUS = 1;
const EXAM_STATUSES = ["Draft", "Live", "Completed"];
const normalizeString = (value) => {
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
};
const parseOptionalNumber = (value) => {
    if (value === undefined) {
        return undefined;
    }
    if (value === null || value === "") {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};
const parseRequiredNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};
const getTeacherRoleId = () => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const teacherRole = yield Role_modal_1.default.findOne({ where: { role: "TEACHER" } });
    return (_a = teacherRole === null || teacherRole === void 0 ? void 0 : teacherRole.id) !== null && _a !== void 0 ? _a : null;
});
const getTeacher = (teacherId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    const teacherRoleId = yield getTeacherRoleId();
    if (!teacherRoleId) {
        return null;
    }
    return User_modal_1.default.findOne({
        where: {
            userId: teacherId,
            instituteId,
            roleId: teacherRoleId,
            status: ACTIVE_USER_STATUS,
            isDeleted: false,
        },
    });
});
const getInstituteUser = (userId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    return User_modal_1.default.findOne({
        where: {
            userId,
            instituteId,
            status: ACTIVE_USER_STATUS,
            isDeleted: false,
        },
    });
});
const getSession = (sessionId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    return Session_modal_1.default.findOne({
        where: {
            sessionId,
            instituteId,
            isDeleted: false,
        },
    });
});
const getClass = (classId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    return Class_modal_1.default.findOne({
        where: {
            classId,
            instituteId,
            isDeleted: false,
        },
    });
});
const getSubject = (subjectId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    return Subject_modal_1.default.findOne({
        where: {
            subjectId,
            instituteId,
            isDeleted: false,
            isActive: true,
        },
    });
});
const validateExamPayload = (body, instituteId, options) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const requireField = (value, field) => {
        if (options.requireMandatoryFields && !value) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `${field} is required.`,
            };
        }
        return null;
    };
    const sessionId = normalizeString(body.sessionId);
    const classId = normalizeString(body.classId);
    const subjectId = normalizeString(body.subjectId);
    const teacherId = normalizeString(body.teacherId);
    const examinerId = body.examinerId === null || body.examinerId === ""
        ? null
        : normalizeString(body.examinerId);
    const examType = normalizeString(body.examType);
    const instructions = body.instructions === null
        ? null
        : typeof body.instructions === "string"
            ? body.instructions.trim() || null
            : undefined;
    const status = normalizeString(body.status);
    const totalMarks = parseRequiredNumber(body.totalMarks);
    const passingMarks = parseRequiredNumber(body.passingMarks);
    const duration = parseOptionalNumber(body.duration);
    const missingSession = requireField(sessionId, "sessionId");
    if (missingSession)
        return missingSession;
    const missingSubject = requireField(subjectId, "subjectId");
    if (missingSubject)
        return missingSubject;
    const missingTeacher = requireField(teacherId, "teacherId");
    if (missingTeacher)
        return missingTeacher;
    const missingType = requireField(examType, "examType");
    if (missingType)
        return missingType;
    if (options.requireMandatoryFields && totalMarks === undefined) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: "totalMarks is required and must be a number.",
        };
    }
    if (options.requireMandatoryFields && passingMarks === undefined) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: "passingMarks is required and must be a number.",
        };
    }
    if (body.totalMarks !== undefined && totalMarks === undefined) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: "totalMarks must be a valid number.",
        };
    }
    if (body.passingMarks !== undefined && passingMarks === undefined) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: "passingMarks must be a valid number.",
        };
    }
    if (body.duration !== undefined && duration === undefined) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: "duration must be a valid number.",
        };
    }
    const resolvedStatus = status !== null && status !== void 0 ? status : (_b = options.currentExam) === null || _b === void 0 ? void 0 : _b.status;
    if (status && !EXAM_STATUSES.includes(status)) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: `Status must be one of: ${EXAM_STATUSES.join(", ")}`,
        };
    }
    const resolvedTotalMarks = totalMarks !== null && totalMarks !== void 0 ? totalMarks : (_c = options.currentExam) === null || _c === void 0 ? void 0 : _c.totalMarks;
    const resolvedPassingMarks = passingMarks !== null && passingMarks !== void 0 ? passingMarks : (_d = options.currentExam) === null || _d === void 0 ? void 0 : _d.passingMarks;
    if (resolvedTotalMarks !== undefined &&
        resolvedPassingMarks !== undefined &&
        resolvedPassingMarks > resolvedTotalMarks) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: "Passing marks cannot be greater than total marks.",
        };
    }
    const resolvedSessionId = sessionId !== null && sessionId !== void 0 ? sessionId : (_e = options.currentExam) === null || _e === void 0 ? void 0 : _e.sessionId;
    const resolvedTeacherId = teacherId !== null && teacherId !== void 0 ? teacherId : (_f = options.currentExam) === null || _f === void 0 ? void 0 : _f.teacherId;
    const resolvedSubjectId = subjectId !== null && subjectId !== void 0 ? subjectId : (_g = options.currentExam) === null || _g === void 0 ? void 0 : _g.subjectId;
    let session = null;
    if (resolvedSessionId) {
        session = yield getSession(resolvedSessionId, instituteId);
        if (!session) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Session not found in your institute.",
            };
        }
    }
    let teacher = null;
    if (resolvedTeacherId) {
        teacher = yield getTeacher(resolvedTeacherId, instituteId);
        if (!teacher) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher not found in your institute.",
            };
        }
    }
    let subject = null;
    if (resolvedSubjectId) {
        subject = yield getSubject(resolvedSubjectId, instituteId);
        if (!subject) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Subject not found in your institute.",
            };
        }
    }
    const requestedClassId = (_h = classId !== null && classId !== void 0 ? classId : (body.classId === null ? null : undefined)) !== null && _h !== void 0 ? _h : (_j = options.currentExam) === null || _j === void 0 ? void 0 : _j.classId;
    const resolvedClassId = requestedClassId === undefined ? (_k = subject === null || subject === void 0 ? void 0 : subject.classId) !== null && _k !== void 0 ? _k : null : requestedClassId;
    let classData = null;
    if (resolvedClassId) {
        classData = yield getClass(resolvedClassId, instituteId);
        if (!classData) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Class not found in your institute.",
            };
        }
    }
    if (subject && resolvedClassId && subject.classId !== resolvedClassId) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: "The selected subject does not belong to the selected class.",
        };
    }
    let examiner = null;
    const resolvedExaminerId = examinerId === null
        ? null
        : (_m = examinerId !== null && examinerId !== void 0 ? examinerId : (_l = options.currentExam) === null || _l === void 0 ? void 0 : _l.examinerId) !== null && _m !== void 0 ? _m : null;
    if (resolvedExaminerId) {
        examiner = yield getInstituteUser(resolvedExaminerId, instituteId);
        if (!examiner) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Examiner not found in your institute.",
            };
        }
    }
    return {
        error: false,
        values: {
            session,
            classData,
            subject,
            teacher,
            examiner,
            sessionId: resolvedSessionId,
            classId: resolvedClassId !== null && resolvedClassId !== void 0 ? resolvedClassId : null,
            subjectId: resolvedSubjectId,
            teacherId: resolvedTeacherId,
            examinerId: resolvedExaminerId,
            examType,
            totalMarks,
            passingMarks,
            duration,
            instructions,
            status: resolvedStatus,
        },
    };
});
const createExam = (body, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _o, _p;
    try {
        const instituteId = createdBy.instituteId;
        if (!instituteId) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Institute not found for this user.",
            };
        }
        const validation = yield validateExamPayload(body, instituteId, {
            requireMandatoryFields: true,
        });
        if (validation.error) {
            return validation;
        }
        const values = validation.values;
        const duplicate = yield Exam_modal_1.default.findOne({
            where: {
                instituteId,
                sessionId: values.sessionId,
                classId: values.classId,
                subjectId: values.subjectId,
                examType: values.examType,
                isDeleted: false,
            },
        });
        if (duplicate) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "An exam with the same session, class, subject, type, and date already exists.",
            };
        }
        const examId = yield helper_1.default.generateUserId();
        const exam = yield Exam_modal_1.default.create({
            examId,
            instituteId,
            sessionId: values.sessionId,
            classId: values.classId,
            examType: values.examType,
            subjectId: values.subjectId,
            teacherId: values.teacherId,
            examinerId: values.examinerId,
            totalMarks: values.totalMarks,
            passingMarks: values.passingMarks,
            duration: (_o = values.duration) !== null && _o !== void 0 ? _o : null,
            instructions: (_p = values.instructions) !== null && _p !== void 0 ? _p : null,
            status: "Draft",
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Exam created successfully.",
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
const getAllExams = (query, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const instituteId = requestedBy.instituteId;
        const { status = "", sessionId = "", classId = "", subjectId = "", teacherId = "", examinerId = "", search = "", } = query;
        const where = {
            instituteId,
            isDeleted: false,
        };
        if (status)
            where.status = status;
        if (sessionId)
            where.sessionId = sessionId;
        if (classId)
            where.classId = classId;
        if (subjectId)
            where.subjectId = subjectId;
        if (teacherId)
            where.teacherId = teacherId;
        if (examinerId)
            where.examinerId = examinerId;
        if (search) {
            where[sequelize_1.Op.or] = [
                { examType: { [sequelize_1.Op.iLike]: `%${search}%` } },
                { examId: { [sequelize_1.Op.iLike]: `%${search}%` } },
            ];
        }
        const exams = yield Exam_modal_1.default.findAll({
            where,
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
const getExamById = (examId, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const exam = yield Exam_modal_1.default.findOne({
            where: { examId, isDeleted: false },
        });
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
const updateExamStatus = (examId, status, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!EXAM_STATUSES.includes(status)) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: `Status must be one of: ${EXAM_STATUSES.join(", ")}`,
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
const updateExam = (examId, body, requestedBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _q, _r, _s, _t, _u, _v, _w;
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
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Exam not found.",
            };
        }
        if (exam.status === "Completed") {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Completed exam cannot be updated.",
            };
        }
        const validation = yield validateExamPayload(body, instituteId, {
            currentExam: exam,
            requireMandatoryFields: false,
        });
        if (validation.error) {
            return validation;
        }
        const values = validation.values;
        const nextExamType = (_q = values.examType) !== null && _q !== void 0 ? _q : exam.examType;
        const nextSessionId = (_r = values.sessionId) !== null && _r !== void 0 ? _r : exam.sessionId;
        const nextClassId = values.classId !== undefined ? values.classId : exam.classId;
        const nextSubjectId = (_s = values.subjectId) !== null && _s !== void 0 ? _s : exam.subjectId;
        const duplicate = yield Exam_modal_1.default.findOne({
            where: {
                examId: { [sequelize_1.Op.ne]: examId },
                instituteId,
                sessionId: nextSessionId,
                classId: nextClassId,
                subjectId: nextSubjectId,
                examType: nextExamType,
                isDeleted: false,
            },
        });
        if (duplicate) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Another exam with the same session, class, subject, type, and date already exists.",
            };
        }
        yield exam.update({
            sessionId: nextSessionId,
            classId: nextClassId,
            examType: nextExamType,
            subjectId: nextSubjectId,
            teacherId: (_t = values.teacherId) !== null && _t !== void 0 ? _t : exam.teacherId,
            examinerId: values.examinerId !== undefined ? values.examinerId : exam.examinerId,
            totalMarks: (_u = values.totalMarks) !== null && _u !== void 0 ? _u : exam.totalMarks,
            passingMarks: (_v = values.passingMarks) !== null && _v !== void 0 ? _v : exam.passingMarks,
            duration: values.duration !== undefined ? values.duration : exam.duration,
            instructions: values.instructions !== undefined ? values.instructions : exam.instructions,
            status: (_w = values.status) !== null && _w !== void 0 ? _w : exam.status,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Exam updated successfully.",
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
exports.default = {
    createExam,
    getAllExams,
    getExamById,
    updateExamStatus,
    updateExam,
    deleteExam,
};
