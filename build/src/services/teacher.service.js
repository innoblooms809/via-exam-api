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
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Subject_modal_1 = __importDefault(require("../modals/Subject.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const helper_1 = __importDefault(require("../utils/helper"));
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
        // Validate class assignment: ensure class does not already have a class teacher
        if (body.teacherType === "Class Teacher" && body.classId) {
            const cls = yield Class_modal_1.default.findOne({
                where: { classId: body.classId, instituteId, isDeleted: false },
                transaction: t,
            });
            if (cls && cls.classTeacherId) {
                const existingTeacher = yield User_modal_1.default.findOne({
                    where: { userId: cls.classTeacherId, instituteId },
                    transaction: t,
                });
                const teacherName = existingTeacher ? existingTeacher.userName : "another teacher";
                yield t.rollback();
                return {
                    error: true,
                    statusCode: http_status_1.default.BAD_REQUEST,
                    message: `Class "${cls.className}" already has a Class Teacher assigned: ${teacherName}. Please choose a different class.`,
                };
            }
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
            teacherType: body.teacherType,
            qualification: body.qualification,
            specialization: body.specialization || null,
            experience: body.experience || null,
            address: body.address || null,
            joiningDate: new Date(body.joiningDate),
            dob: new Date(body.dob),
            profileUrl,
            isExaminer: false,
            examinerSince: null,
        }, { transaction: t });
        // Assign teacher to Class if they are a Class Teacher
        if (body.teacherType === "Class Teacher" && body.classId) {
            const cls = yield Class_modal_1.default.findOne({
                where: { classId: body.classId, instituteId },
                transaction: t,
            });
            if (cls) {
                yield cls.update({ classTeacherId: newUser.userId }, { transaction: t });
            }
            else {
            }
        }
        // 10. Commit
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Teacher created successfully.",
            data: {
                instituteName: institute.instituteName,
                plainPassword,
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
        const teacherIds = teachers.map((u) => u.userId);
        const assignedClasses = yield Class_modal_1.default.findAll({
            where: {
                classTeacherId: { [sequelize_2.Op.in]: teacherIds },
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        const assignedSubjects = yield Subject_modal_1.default.findAll({
            where: {
                teacherId: { [sequelize_2.Op.in]: teacherIds },
                instituteId: createdBy.instituteId,
                isDeleted: false,
            },
        });
        let result = teachers.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
            const cls = assignedClasses.find((c) => c.classTeacherId === u.userId);
            const subs = assignedSubjects.filter((s) => s.teacherId === u.userId);
            return {
                userId: u.userId,
                userName: u.userName,
                emailId: u.emailId,
                phoneNumber: u.phoneNumber,
                status: u.status,
                instituteId: u.instituteId,
                address: (_b = (_a = u.teacherProfile) === null || _a === void 0 ? void 0 : _a.address) !== null && _b !== void 0 ? _b : null,
                teacherType: (_d = (_c = u.teacherProfile) === null || _c === void 0 ? void 0 : _c.teacherType) !== null && _d !== void 0 ? _d : null,
                qualification: (_f = (_e = u.teacherProfile) === null || _e === void 0 ? void 0 : _e.qualification) !== null && _f !== void 0 ? _f : null,
                specialization: (_h = (_g = u.teacherProfile) === null || _g === void 0 ? void 0 : _g.specialization) !== null && _h !== void 0 ? _h : null,
                experience: (_k = (_j = u.teacherProfile) === null || _j === void 0 ? void 0 : _j.experience) !== null && _k !== void 0 ? _k : null,
                joiningDate: (_m = (_l = u.teacherProfile) === null || _l === void 0 ? void 0 : _l.joiningDate) !== null && _m !== void 0 ? _m : null,
                dob: (_p = (_o = u.teacherProfile) === null || _o === void 0 ? void 0 : _o.dob) !== null && _p !== void 0 ? _p : null,
                profileUrl: (_r = (_q = u.teacherProfile) === null || _q === void 0 ? void 0 : _q.profileUrl) !== null && _r !== void 0 ? _r : null,
                isExaminer: (_t = (_s = u.teacherProfile) === null || _s === void 0 ? void 0 : _s.isExaminer) !== null && _t !== void 0 ? _t : false,
                examinerSince: (_v = (_u = u.teacherProfile) === null || _u === void 0 ? void 0 : _u.examinerSince) !== null && _v !== void 0 ? _v : null,
                assignedClass: cls ? { classId: cls.classId, className: cls.className } : null,
                assignedSubjects: subs.map((s) => ({ subjectId: s.subjectId, subjectName: s.subjectName })),
            };
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
        // Find assigned class if teacher is Class Teacher
        const allClassesForTeacher = yield Class_modal_1.default.findAll({
            where: { classTeacherId: userId }
        });
        const assignedClass = yield Class_modal_1.default.findOne({
            where: { classTeacherId: userId, instituteId: createdBy.instituteId, isDeleted: false },
        });
        const teacherData = teacher.toJSON();
        if (assignedClass) {
            teacherData.assignedClass = {
                classId: assignedClass.classId,
                className: assignedClass.className,
            };
        }
        else {
            teacherData.assignedClass = null;
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher fetched successfully.",
            data: teacherData,
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
    var _b, _c, _d, _e, _f, _g, _h, _j;
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
                address: (_h = body.address) !== null && _h !== void 0 ? _h : profile.address,
                profileUrl,
            }, { transaction: t });
            // If teacherType is updated to something other than "Class Teacher",
            // remove them as class teacher from any class they were assigned to.
            const newTeacherType = (_j = body.teacherType) !== null && _j !== void 0 ? _j : profile.teacherType;
            if (newTeacherType !== "Class Teacher") {
                const cls = yield Class_modal_1.default.findOne({
                    where: { classTeacherId: userId, instituteId: createdBy.instituteId },
                    transaction: t,
                });
                if (cls) {
                    yield cls.update({ classTeacherId: null }, { transaction: t });
                }
            }
            else {
                // If teacher is a Class Teacher and classId is updated
                if (body.classId !== undefined) {
                    // 1. Clear this teacher from any class they are currently assigned to
                    yield Class_modal_1.default.update({ classTeacherId: null }, { where: { classTeacherId: userId, instituteId: createdBy.instituteId }, transaction: t });
                    // 2. If a classId is specified, validate and assign it
                    if (body.classId) {
                        const newClass = yield Class_modal_1.default.findOne({
                            where: { classId: body.classId, instituteId: createdBy.instituteId, isDeleted: false },
                            transaction: t,
                        });
                        if (newClass) {
                            // Ensure that class is not already assigned to another teacher!
                            if (newClass.classTeacherId && newClass.classTeacherId !== userId) {
                                const existingTeacher = yield User_modal_1.default.findOne({
                                    where: { userId: newClass.classTeacherId, instituteId: createdBy.instituteId },
                                    transaction: t,
                                });
                                const teacherName = existingTeacher ? existingTeacher.userName : "another teacher";
                                yield t.rollback();
                                return {
                                    error: true,
                                    statusCode: http_status_1.default.BAD_REQUEST,
                                    message: `Class "${newClass.className}" already has a Class Teacher assigned: ${teacherName}. Please choose a different class.`,
                                };
                            }
                            yield newClass.update({ classTeacherId: userId }, { transaction: t });
                        }
                    }
                }
            }
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
        // Unassign teacher from any class they were teaching
        const assignedClass = yield Class_modal_1.default.findOne({
            where: { classTeacherId: userId, instituteId: createdBy.instituteId },
        });
        if (assignedClass) {
            yield assignedClass.update({ classTeacherId: null });
        }
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
// ─── GET DEACTIVATED TEACHERS ──────────────────────────────────────────────────
const getDeactivatedTeachers = (createdBy, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search = "" } = query;
        const teacherRole = yield Role_modal_1.default.findOne({ where: { role: "TEACHER" } });
        const where = {
            instituteId: createdBy.instituteId,
            roleId: teacherRole === null || teacherRole === void 0 ? void 0 : teacherRole.id,
            status: 0, // 0 = Deactivated
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
        const result = teachers.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
            return ({
                userId: u.userId,
                userName: u.userName,
                emailId: u.emailId,
                phoneNumber: u.phoneNumber,
                status: u.status,
                instituteId: u.instituteId,
                address: (_b = (_a = u.teacherProfile) === null || _a === void 0 ? void 0 : _a.address) !== null && _b !== void 0 ? _b : null,
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
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Deactivated teachers fetched successfully.",
            data: {
                teachers: result,
                total: result.length,
            },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: e.message,
        };
    }
});
// ─── REACTIVATE TEACHER ──────────────────────────────────────────────────────
const reactivateTeacher = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
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
        yield user.update({ status: 1 });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Teacher reactivated successfully.",
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
// ─── GET MY ASSIGNMENTS ─────────────────────────────────────────────────────────
const getMyAssignments = (teacherId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const assignedSubjects = yield Subject_modal_1.default.findAll({
            where: {
                teacherId,
                isActive: true,
                isDeleted: false,
            },
            include: [
                {
                    model: Class_modal_1.default,
                    as: "class",
                    attributes: ["classId", "className"],
                    required: false,
                },
            ],
        });
        const assignedClasses = yield Class_modal_1.default.findAll({
            where: {
                classTeacherId: teacherId,
                isActive: true,
                isDeleted: false,
            },
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Assignments fetched successfully",
            data: {
                assignedSubjects,
                assignedClasses,
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
exports.default = {
    createTeacher,
    getAllTeachers,
    getTeacherById,
    updateTeacher,
    deleteTeacher,
    assignExaminer,
    removeExaminer,
    getDeactivatedTeachers,
    reactivateTeacher,
    getMyAssignments,
};
