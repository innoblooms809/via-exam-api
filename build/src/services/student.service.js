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
const Student_modal_1 = __importDefault(require("../modals/Student.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const helper_1 = __importDefault(require("../utils/helper"));
const exclude_1 = __importDefault(require("../utils/exclude"));
const sequelize_1 = require("../config/sequelize");
const sequelize_2 = require("sequelize");
// ─── CREATE STUDENT ───────────────────────────────────────────────────────────
const createStudent = (body, files, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const instituteId = createdBy.instituteId;
        if (!instituteId) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Institute not found for this admin.",
            };
        }
        // 1. Check institute active
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
        // 2. Check email unique
        const emailExists = yield User_modal_1.default.findOne({
            where: { emailId: body.email },
        });
        if (emailExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Email is already registered.",
            };
        }
        // 3. Check phone unique
        const phoneExists = yield User_modal_1.default.findOne({
            where: { phoneNumber: body.mobile },
        });
        if (phoneExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Phone number is already registered.",
            };
        }
        // 4. Check roll number unique within class+division+year
        const rollExists = yield Student_modal_1.default.findOne({
            where: {
                instituteId,
                rollNumber: body.rollNumber,
                className: body.className,
                division: body.division,
                academicYear: body.academicYear,
            },
        });
        if (rollExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: `Roll number ${body.rollNumber} already exists in ${body.className} ${body.division} for ${body.academicYear}.`,
            };
        }
        // 5. Find STUDENT role
        const studentRole = yield Role_modal_1.default.findOne({ where: { role: "STUDENT" } });
        if (!studentRole) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
                message: "STUDENT role not found. Please seed roles.",
            };
        }
        // 6. Profile photo
        const profileUrl = ((_a = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _a === void 0 ? void 0 : _a[0])
            ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
            : null;
        // 7. Create user
        const plainPassword = body.password || (yield helper_1.default.generatePassword());
        const encryptedPassword = yield encryption_1.default.encryptPassword(plainPassword);
        const userId = yield helper_1.default.generateUserId();
        const newUser = yield User_modal_1.default.create({
            userId,
            userName: `${body.firstName} ${body.lastName}`,
            emailId: body.email,
            phoneNumber: body.mobile,
            password: encryptedPassword,
            roleId: studentRole.id,
            instituteId,
            status: 1,
        }, { transaction: t });
        // 8. Create student profile
        yield Student_modal_1.default.create({
            userId: newUser.userId,
            instituteId,
            rollNumber: body.rollNumber,
            className: body.className,
            division: body.division,
            academicYear: body.academicYear,
            fatherName: body.fatherName,
            gender: body.gender,
            dob: new Date(body.dob),
            aadhar: body.aadhar,
            address: body.address,
            profileUrl,
            isActive: true,
        }, { transaction: t });
        yield t.commit();
        const userResponse = (0, exclude_1.default)(newUser.toJSON(), ["password", "refreshToken"]);
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Student created successfully.",
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
// ─── GET ALL STUDENTS ─────────────────────────────────────────────────────────
const getAllStudents = (createdBy, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search = "", className = "", division = "", academicYear = "", } = query;
        const studentRole = yield Role_modal_1.default.findOne({ where: { role: "STUDENT" } });
        const where = {
            instituteId: createdBy.instituteId,
            roleId: studentRole === null || studentRole === void 0 ? void 0 : studentRole.id,
            status: 1,
        };
        if (search) {
            where[sequelize_2.Op.or] = [
                { userName: { [sequelize_2.Op.iLike]: `%${search}%` } },
                { emailId: { [sequelize_2.Op.iLike]: `%${search}%` } },
            ];
        }
        // Profile filters
        const profileWhere = {};
        if (className)
            profileWhere.className = className;
        if (division)
            profileWhere.division = division;
        if (academicYear)
            profileWhere.academicYear = academicYear;
        const students = yield User_modal_1.default.findAll({
            where,
            include: [
                { model: Role_modal_1.default, as: "role" },
                {
                    model: Student_modal_1.default,
                    as: "studentProfile",
                    required: Object.keys(profileWhere).length > 0,
                    where: Object.keys(profileWhere).length > 0 ? profileWhere : undefined,
                },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
            order: [["userName", "ASC"]],
        });
        const result = students.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
            return ({
                userId: u.userId,
                userName: u.userName,
                emailId: u.emailId,
                phoneNumber: u.phoneNumber,
                status: u.status,
                instituteId: u.instituteId,
                rollNumber: (_b = (_a = u.studentProfile) === null || _a === void 0 ? void 0 : _a.rollNumber) !== null && _b !== void 0 ? _b : null,
                className: (_d = (_c = u.studentProfile) === null || _c === void 0 ? void 0 : _c.className) !== null && _d !== void 0 ? _d : null,
                division: (_f = (_e = u.studentProfile) === null || _e === void 0 ? void 0 : _e.division) !== null && _f !== void 0 ? _f : null,
                academicYear: (_h = (_g = u.studentProfile) === null || _g === void 0 ? void 0 : _g.academicYear) !== null && _h !== void 0 ? _h : null,
                fatherName: (_k = (_j = u.studentProfile) === null || _j === void 0 ? void 0 : _j.fatherName) !== null && _k !== void 0 ? _k : null,
                gender: (_m = (_l = u.studentProfile) === null || _l === void 0 ? void 0 : _l.gender) !== null && _m !== void 0 ? _m : null,
                dob: (_p = (_o = u.studentProfile) === null || _o === void 0 ? void 0 : _o.dob) !== null && _p !== void 0 ? _p : null,
                aadhar: (_r = (_q = u.studentProfile) === null || _q === void 0 ? void 0 : _q.aadhar) !== null && _r !== void 0 ? _r : null,
                address: (_t = (_s = u.studentProfile) === null || _s === void 0 ? void 0 : _s.address) !== null && _t !== void 0 ? _t : null,
                profileUrl: (_v = (_u = u.studentProfile) === null || _u === void 0 ? void 0 : _u.profileUrl) !== null && _v !== void 0 ? _v : null,
            });
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Students fetched successfully.",
            data: { students: result, total: result.length },
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
// ─── GET ONE STUDENT ──────────────────────────────────────────────────────────
const getStudentById = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const student = yield User_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
            include: [
                { model: Role_modal_1.default, as: "role" },
                { model: Student_modal_1.default, as: "studentProfile" },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
        });
        if (!student) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Student not found.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student fetched successfully.",
            data: student,
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
// ─── UPDATE STUDENT ───────────────────────────────────────────────────────────
const updateStudent = (userId, body, files, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
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
                message: "Student not found.",
            };
        }
        const profile = yield Student_modal_1.default.findOne({ where: { userId } });
        // Update user
        yield user.update({
            userName: body.firstName && body.lastName
                ? `${body.firstName} ${body.lastName}`
                : user.userName,
            phoneNumber: (_b = body.mobile) !== null && _b !== void 0 ? _b : user.phoneNumber,
        }, { transaction: t });
        // Update profile
        if (profile) {
            const profileUrl = ((_c = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _c === void 0 ? void 0 : _c[0])
                ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
                : profile.profileUrl;
            yield profile.update({
                fatherName: (_d = body.fatherName) !== null && _d !== void 0 ? _d : profile.fatherName,
                gender: (_e = body.gender) !== null && _e !== void 0 ? _e : profile.gender,
                division: (_f = body.division) !== null && _f !== void 0 ? _f : profile.division,
                className: (_g = body.className) !== null && _g !== void 0 ? _g : profile.className,
                academicYear: (_h = body.academicYear) !== null && _h !== void 0 ? _h : profile.academicYear,
                address: (_j = body.address) !== null && _j !== void 0 ? _j : profile.address,
                profileUrl,
            }, { transaction: t });
        }
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student updated successfully.",
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
// ─── DEACTIVATE STUDENT ───────────────────────────────────────────────────────
const deleteStudent = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield User_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Student not found.",
            };
        }
        yield user.update({ status: 0 });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student deactivated successfully.",
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
// ─── BULK CREATE STUDENTS ─────────────────────────────────────────────────────
const bulkCreateStudents = (students, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const instituteId = createdBy.instituteId;
        const studentRole = yield Role_modal_1.default.findOne({ where: { role: "STUDENT" } });
        if (!studentRole) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
                message: "STUDENT role not found.",
            };
        }
        let created = 0;
        let skipped = 0;
        const errors = [];
        for (const s of students) {
            try {
                // Check duplicates
                const emailExists = yield User_modal_1.default.findOne({ where: { emailId: s.email } });
                const rollExists = yield Student_modal_1.default.findOne({
                    where: {
                        instituteId,
                        rollNumber: s.rollNumber,
                        className: s.className,
                        division: s.division,
                        academicYear: s.academicYear,
                    },
                });
                if (emailExists || rollExists) {
                    skipped++;
                    continue;
                }
                const plainPassword = yield helper_1.default.generatePassword();
                const encryptedPassword = yield encryption_1.default.encryptPassword(plainPassword);
                const userId = yield helper_1.default.generateUserId();
                const newUser = yield User_modal_1.default.create({
                    userId,
                    userName: `${s.firstName} ${s.lastName}`,
                    emailId: s.email,
                    phoneNumber: s.mobile,
                    password: encryptedPassword,
                    roleId: studentRole.id,
                    instituteId,
                    status: 1,
                }, { transaction: t });
                yield Student_modal_1.default.create({
                    userId: newUser.userId,
                    instituteId,
                    rollNumber: s.rollNumber,
                    className: s.className,
                    division: s.division,
                    academicYear: s.academicYear,
                    fatherName: s.fatherName || "Not provided",
                    gender: s.gender || "other",
                    dob: new Date(s.dob || "2000-01-01"),
                    aadhar: s.aadhar || "000000000000",
                    address: s.address || "Not provided",
                }, { transaction: t });
                created++;
            }
            catch (err) {
                errors.push(`Row ${created + skipped + 1}: Failed`);
                skipped++;
            }
        }
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: `Bulk upload complete.`,
            data: { created, skipped, errors },
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
exports.default = {
    createStudent,
    getAllStudents,
    getStudentById,
    updateStudent,
    deleteStudent,
    bulkCreateStudents,
};
