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
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const TeacherProfile_modal_1 = __importDefault(require("../modals/TeacherProfile.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const helper_1 = __importDefault(require("../utils/helper"));
const exclude_1 = __importDefault(require("../utils/exclude"));
const sequelize_1 = require("../config/sequelize");
const sequelize_2 = require("sequelize");
// ─── CREATE TEACHER ───────────────────────────────────────────────────────────
const createTeacher = (body, files, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const t = yield sequelize_1.sequelize.transaction();
    try {
        // 1. Get instituteId from admin token
        const instituteId = createdBy.instituteId;
        if (!instituteId) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Institute not found for this admin.",
            };
        }
        // 2. Check institute active
        const institute = yield Institute_modal_1.default.findOne({
            where: { instituteId, isDeleted: false, status: 1 },
        });
        if (!institute) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Institute not found or inactive.",
            };
        }
        // 3. Check email unique
        const emailExists = yield User_modal_1.default.findOne({
            where: { emailId: body.emailId },
        });
        if (emailExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Email is already registered.",
            };
        }
        // 4. Check phone unique
        const phoneExists = yield User_modal_1.default.findOne({
            where: { phoneNumber: body.phoneNumber },
        });
        if (phoneExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Phone number is already registered.",
            };
        }
        // 5. Check employeeID unique within institute
        const empExists = yield TeacherProfile_modal_1.default.findOne({
            where: { employeeID: body.employeeID, instituteId },
        });
        if (empExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Employee ID already exists in this institute.",
            };
        }
        // 6. Find TEACHER role
        const teacherRole = yield Role_modal_1.default.findOne({ where: { role: "TEACHER" } });
        if (!teacherRole) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
                message: "TEACHER role not found. Please seed roles.",
            };
        }
        // 7. Profile photo
        const profileUrl = ((_a = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _a === void 0 ? void 0 : _a[0])
            ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
            : null;
        // 8. Create user record
        const plainPassword = body.password || (yield helper_1.default.generatePassword());
        const encryptedPassword = yield encryption_1.default.encryptPassword(plainPassword);
        const userId = yield helper_1.default.generateUserId();
        const newUser = yield User_modal_1.default.create({
            userId,
            userName: `${body.firstName} ${body.lastName}`,
            emailId: body.emailId,
            phoneNumber: body.phoneNumber,
            password: encryptedPassword,
            roleId: teacherRole.id,
            instituteId,
            status: 1,
        }, { transaction: t });
        // 9. Create teacher profile record
        yield TeacherProfile_modal_1.default.create({
            userId: newUser.userId,
            instituteId,
            employeeID: body.employeeID,
            teacherType: body.teacherType,
            qualification: body.qualification,
            specialization: body.specialization || null,
            experience: body.experience || null,
            joiningDate: new Date(body.joiningDate),
            dob: new Date(body.dob),
            profileUrl,
            isExaminer: false,
            examinerSince: null,
        }, { transaction: t });
        // 10. Commit
        yield t.commit();
        const userResponse = (0, exclude_1.default)(newUser.toJSON(), [
            "password",
            "refreshToken",
        ]);
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Teacher created successfully.",
            data: {
                user: userResponse,
                plainPassword,
                instituteName: institute.instituteName,
            },
        };
    }
    catch (e) {
        yield t.rollback();
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── GET ALL TEACHERS ─────────────────────────────────────────────────────────
const getAllTeachers = (createdBy, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search = "", isExaminer = "" } = query;
        const teacherRole = yield Role_modal_1.default.findOne({ where: { role: "TEACHER" } });
        const where = {
            instituteId: createdBy.instituteId,
            roleId: teacherRole === null || teacherRole === void 0 ? void 0 : teacherRole.id,
            status: 1,
        };
        if (search) {
            where[sequelize_2.Op.or] = [
                { userName: { [sequelize_2.Op.iLike]: `%${search}%` } },
                { emailId: { [sequelize_2.Op.iLike]: `%${search}%` } },
            ];
        }
        const teachers = yield User_modal_1.default.findAll({
            where,
            include: [
                { model: Role_modal_1.default, as: "role" },
                { model: TeacherProfile_modal_1.default, as: "teacherProfile", required: false },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
            order: [["userName", "ASC"]],
        });
        let result = teachers.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
            return ({
                userId: u.userId,
                userName: u.userName,
                emailId: u.emailId,
                phoneNumber: u.phoneNumber,
                status: u.status,
                instituteId: u.instituteId,
                employeeID: (_b = (_a = u.teacherProfile) === null || _a === void 0 ? void 0 : _a.employeeID) !== null && _b !== void 0 ? _b : null,
                teacherType: (_d = (_c = u.teacherProfile) === null || _c === void 0 ? void 0 : _c.teacherType) !== null && _d !== void 0 ? _d : null,
                qualification: (_f = (_e = u.teacherProfile) === null || _e === void 0 ? void 0 : _e.qualification) !== null && _f !== void 0 ? _f : null,
                specialization: (_h = (_g = u.teacherProfile) === null || _g === void 0 ? void 0 : _g.specialization) !== null && _h !== void 0 ? _h : null,
                experience: (_k = (_j = u.teacherProfile) === null || _j === void 0 ? void 0 : _j.experience) !== null && _k !== void 0 ? _k : null,
                joiningDate: (_m = (_l = u.teacherProfile) === null || _l === void 0 ? void 0 : _l.joiningDate) !== null && _m !== void 0 ? _m : null,
                dob: (_p = (_o = u.teacherProfile) === null || _o === void 0 ? void 0 : _o.dob) !== null && _p !== void 0 ? _p : null,
                profileUrl: (_r = (_q = u.teacherProfile) === null || _q === void 0 ? void 0 : _q.profileUrl) !== null && _r !== void 0 ? _r : null,
                isExaminer: (_t = (_s = u.teacherProfile) === null || _s === void 0 ? void 0 : _s.isExaminer) !== null && _t !== void 0 ? _t : false,
                examinerSince: (_v = (_u = u.teacherProfile) === null || _u === void 0 ? void 0 : _u.examinerSince) !== null && _v !== void 0 ? _v : null,
            });
        });
        // Filter by examiner flag
        if (isExaminer === "true")
            result = result.filter((r) => r.isExaminer);
        if (isExaminer === "false")
            result = result.filter((r) => !r.isExaminer);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teachers fetched successfully.",
            data: {
                teachers: result,
                total: result.length,
                examinerCount: result.filter((r) => r.isExaminer).length,
                teacherCount: result.filter((r) => !r.isExaminer).length,
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
// ─── GET ONE TEACHER ──────────────────────────────────────────────────────────
const getTeacherById = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const teacher = yield User_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
            include: [
                { model: Role_modal_1.default, as: "role" },
                { model: TeacherProfile_modal_1.default, as: "teacherProfile" },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
        });
        if (!teacher) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher not found.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher fetched successfully.",
            data: teacher,
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
// ─── UPDATE TEACHER ───────────────────────────────────────────────────────────
const updateTeacher = (userId, body, files, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c, _d, _e, _f, _g;
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const user = yield User_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
        });
        if (!user) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher not found.",
            };
        }
        const profile = yield TeacherProfile_modal_1.default.findOne({ where: { userId } });
        // Update user
        yield user.update({
            userName: body.firstName && body.lastName
                ? `${body.firstName} ${body.lastName}`
                : user.userName,
            phoneNumber: (_b = body.phoneNumber) !== null && _b !== void 0 ? _b : user.phoneNumber,
        }, { transaction: t });
        // Update profile
        if (profile) {
            const profileUrl = ((_c = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _c === void 0 ? void 0 : _c[0])
                ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
                : profile.profileUrl;
            yield profile.update({
                teacherType: (_d = body.teacherType) !== null && _d !== void 0 ? _d : profile.teacherType,
                qualification: (_e = body.qualification) !== null && _e !== void 0 ? _e : profile.qualification,
                specialization: (_f = body.specialization) !== null && _f !== void 0 ? _f : profile.specialization,
                experience: (_g = body.experience) !== null && _g !== void 0 ? _g : profile.experience,
                profileUrl,
            }, { transaction: t });
        }
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher updated successfully.",
            data: { userId, userName: user.userName },
        };
    }
    catch (e) {
        yield t.rollback();
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ─── SOFT DELETE TEACHER ──────────────────────────────────────────────────────
const deleteTeacher = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield User_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher not found.",
            };
        }
        yield user.update({ status: 0 });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher deactivated successfully.",
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
// ─── ASSIGN EXAMINER ──────────────────────────────────────────────────────────
const assignExaminer = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const profile = yield TeacherProfile_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
        });
        if (!profile) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher profile not found.",
            };
        }
        if (profile.isExaminer) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Teacher is already an examiner.",
            };
        }
        yield profile.update({
            isExaminer: true,
            examinerSince: new Date(),
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher assigned as examiner successfully.",
            data: { userId, isExaminer: true },
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
// ─── REMOVE EXAMINER ──────────────────────────────────────────────────────────
const removeExaminer = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const profile = yield TeacherProfile_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
        });
        if (!profile) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Teacher profile not found.",
            };
        }
        if (!profile.isExaminer) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Teacher is not an examiner.",
            };
        }
        yield profile.update({
            isExaminer: false,
            examinerSince: null,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Examiner role removed successfully.",
            data: { userId, isExaminer: false },
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
    createTeacher,
    getAllTeachers,
    getTeacherById,
    updateTeacher,
    deleteTeacher,
    assignExaminer,
    removeExaminer,
};
