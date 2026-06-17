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
const Class_modal_1 = __importDefault(require("../modals/Class.modal"));
const Section_modal_1 = __importDefault(require("../modals/Section.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const helper_1 = __importDefault(require("../utils/helper"));
const exclude_1 = __importDefault(require("../utils/exclude"));
const sequelize_1 = require("../config/sequelize");
const sequelize_2 = require("sequelize");
// ─── HELPERS ─────────────────────────────────────────────────────────────────
const resolveClassId = (inputClass, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!inputClass)
        return null;
    const candidates = [inputClass];
    // Try stripping "Class " prefix (e.g. "Class 10" → "10")
    if (inputClass.startsWith("Class "))
        candidates.push(inputClass.slice(6));
    // Try adding "Class " prefix (e.g. "10" → "Class 10")
    if (!inputClass.startsWith("Class "))
        candidates.push(`Class ${inputClass}`);
    const byId = yield Class_modal_1.default.findOne({
        where: { classId: inputClass, instituteId, isDeleted: false },
    });
    if (byId)
        return byId.classId;
    for (const name of candidates) {
        const byName = yield Class_modal_1.default.findOne({
            where: { className: name, instituteId, isDeleted: false },
        });
        if (byName)
            return byName.classId;
    }
    return null;
});
const resolveSectionId = (inputSection, classId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    if (!inputSection)
        return "";
    const byId = yield Section_modal_1.default.findOne({
        where: { sectionId: inputSection, instituteId, isDeleted: false },
    });
    if (byId)
        return byId.sectionId;
    const byName = yield Section_modal_1.default.findOne({
        where: { sectionName: inputSection, classId, instituteId, isDeleted: false },
    });
    if (byName)
        return byName.sectionId;
    return inputSection;
});
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
        // 4. Resolve classId from Class table
        const resolvedClassId = yield resolveClassId(body.classId || body.className, instituteId);
        // 5. Resolve sectionId from Section table
        const resolvedSectionId = yield resolveSectionId(body.sectionId, resolvedClassId || "", instituteId);
        // Look up section name for user-friendly messages
        const sectionRecord = yield Section_modal_1.default.findOne({
            where: { sectionId: resolvedSectionId },
        });
        const sectionLabel = (sectionRecord === null || sectionRecord === void 0 ? void 0 : sectionRecord.sectionName) || resolvedSectionId;
        // 6. Check roll number unique within class+section+session
        const rollExists = yield Student_modal_1.default.findOne({
            where: {
                instituteId,
                rollNumber: body.rollNumber,
                className: body.className,
                sectionId: resolvedSectionId,
                session: body.session,
            },
        });
        if (rollExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: `Roll number ${body.rollNumber} already exists in ${body.className} Section ${sectionLabel} for session ${body.session}.`,
            };
        }
        // 7. Find STUDENT role
        const studentRole = yield Role_modal_1.default.findOne({ where: { role: "STUDENT" } });
        if (!studentRole) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
                message: "STUDENT role not found. Please seed roles.",
            };
        }
        // 8. Profile photo
        const profileUrl = ((_a = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _a === void 0 ? void 0 : _a[0])
            ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
            : null;
        // 9. Create user
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
        // 10. Create student profile
        yield Student_modal_1.default.create({
            userId: newUser.userId,
            instituteId,
            classId: resolvedClassId,
            rollNumber: body.rollNumber,
            className: body.className,
            sectionId: resolvedSectionId,
            session: body.session,
            fatherName: body.fatherName,
            gender: body.gender,
            dob: new Date(body.dob),
            aadhar: body.aadhar,
            address: body.address,
            profileUrl,
            isActive: true,
        }, { transaction: t });
        yield t.commit();
        const userResponse = (0, exclude_1.default)(newUser.toJSON(), [
            "password",
            "refreshToken",
        ]);
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
        const { search = "", className = "", sectionId = "", session = "", } = query;
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
        if (session)
            profileWhere.session = session;
        if (sectionId) {
            const resolvedClassId = yield resolveClassId(className, createdBy.instituteId);
            const resolvedSectionId = yield resolveSectionId(sectionId, resolvedClassId || "", createdBy.instituteId);
            profileWhere.sectionId = resolvedSectionId;
        }
        const students = yield User_modal_1.default.findAll({
            where,
            include: [
                { model: Role_modal_1.default, as: "role" },
                {
                    model: Student_modal_1.default,
                    as: "studentProfile",
                    required: Object.keys(profileWhere).length > 0,
                    where: Object.keys(profileWhere).length > 0 ? profileWhere : undefined,
                    include: [
                        {
                            model: Class_modal_1.default,
                            as: "class",
                            required: false,
                        },
                        {
                            model: Section_modal_1.default,
                            as: "section",
                            required: false,
                        },
                    ],
                },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
            order: [["userName", "ASC"]],
        });
        const result = students.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
            return ({
                userId: u.userId,
                userName: u.userName,
                emailId: u.emailId,
                phoneNumber: u.phoneNumber,
                status: u.status,
                instituteId: u.instituteId,
                rollNumber: (_b = (_a = u.studentProfile) === null || _a === void 0 ? void 0 : _a.rollNumber) !== null && _b !== void 0 ? _b : null,
                className: (_d = (_c = u.studentProfile) === null || _c === void 0 ? void 0 : _c.className) !== null && _d !== void 0 ? _d : null,
                sectionId: (_f = (_e = u.studentProfile) === null || _e === void 0 ? void 0 : _e.sectionId) !== null && _f !== void 0 ? _f : null,
                sectionName: (_j = (_h = (_g = u.studentProfile) === null || _g === void 0 ? void 0 : _g.section) === null || _h === void 0 ? void 0 : _h.sectionName) !== null && _j !== void 0 ? _j : null,
                session: (_l = (_k = u.studentProfile) === null || _k === void 0 ? void 0 : _k.session) !== null && _l !== void 0 ? _l : null,
                fatherName: (_o = (_m = u.studentProfile) === null || _m === void 0 ? void 0 : _m.fatherName) !== null && _o !== void 0 ? _o : null,
                gender: (_q = (_p = u.studentProfile) === null || _p === void 0 ? void 0 : _p.gender) !== null && _q !== void 0 ? _q : null,
                dob: (_s = (_r = u.studentProfile) === null || _r === void 0 ? void 0 : _r.dob) !== null && _s !== void 0 ? _s : null,
                aadhar: (_u = (_t = u.studentProfile) === null || _t === void 0 ? void 0 : _t.aadhar) !== null && _u !== void 0 ? _u : null,
                address: (_w = (_v = u.studentProfile) === null || _v === void 0 ? void 0 : _v.address) !== null && _w !== void 0 ? _w : null,
                profileUrl: (_y = (_x = u.studentProfile) === null || _x === void 0 ? void 0 : _x.profileUrl) !== null && _y !== void 0 ? _y : null,
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
    var _b, _c;
    try {
        const instituteId = createdBy === null || createdBy === void 0 ? void 0 : createdBy.instituteId;
        const userWhere = { userId };
        const profileWhere = { rollNumber: userId };
        if (instituteId) {
            userWhere.instituteId = instituteId;
            profileWhere.instituteId = instituteId;
        }
        let student = yield User_modal_1.default.findOne({
            where: userWhere,
            include: [
                { model: Role_modal_1.default, as: "role" },
                {
                    model: Student_modal_1.default,
                    as: "studentProfile",
                    include: [
                        { model: Class_modal_1.default, as: "class", where: { isDeleted: false }, required: false },
                        { model: Section_modal_1.default, as: "section", where: { isDeleted: false }, required: false },
                    ],
                },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
        });
        if (!student) {
            const profile = yield Student_modal_1.default.findOne({
                where: profileWhere,
            });
            if (profile && profile.userId) {
                const userSecondWhere = { userId: profile.userId };
                if (instituteId) {
                    userSecondWhere.instituteId = instituteId;
                }
                student = yield User_modal_1.default.findOne({
                    where: userSecondWhere,
                    include: [
                        { model: Role_modal_1.default, as: "role" },
                        {
                            model: Student_modal_1.default,
                            as: "studentProfile",
                            include: [
                                { model: Class_modal_1.default, as: "class", where: { isDeleted: false }, required: false },
                                { model: Section_modal_1.default, as: "section", where: { isDeleted: false }, required: false },
                            ],
                        },
                    ],
                    attributes: { exclude: ["password", "refreshToken"] },
                });
            }
        }
        if (!student) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Student not found.",
            };
        }
        const s = student.toJSON();
        const data = {
            userId: s.userId,
            userName: s.userName,
            emailId: s.emailId,
            phoneNumber: s.phoneNumber,
            status: s.status,
            instituteId: s.instituteId,
            studentProfile: s.studentProfile
                ? Object.assign(Object.assign({}, s.studentProfile), { sectionId: s.studentProfile.sectionId, sectionName: (_c = (_b = s.studentProfile.section) === null || _b === void 0 ? void 0 : _b.sectionName) !== null && _c !== void 0 ? _c : null }) : null,
        };
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Student fetched successfully.",
            data,
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
    var _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
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
        // Check phone unique if phone is being updated
        if (body.mobile && body.mobile !== user.phoneNumber) {
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
        }
        // Check email unique if email is being updated
        if (body.email && body.email !== user.emailId) {
            const emailExists = yield User_modal_1.default.findOne({
                where: { emailId: body.email },
            });
            if (emailExists) {
                yield t.rollback();
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: "Email address is already registered.",
                };
            }
        }
        const profile = yield Student_modal_1.default.findOne({ where: { userId } });
        // Update user
        yield user.update({
            userName: body.firstName && body.lastName
                ? `${body.firstName} ${body.lastName}`
                : user.userName,
            phoneNumber: (_d = body.mobile) !== null && _d !== void 0 ? _d : user.phoneNumber,
            emailId: (_e = body.email) !== null && _e !== void 0 ? _e : user.emailId,
        }, { transaction: t });
        // Update profile
        if (profile) {
            const profileUrl = ((_f = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _f === void 0 ? void 0 : _f[0])
                ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
                : profile.profileUrl;
            const targetRollNumber = (_g = body.rollNumber) !== null && _g !== void 0 ? _g : profile.rollNumber;
            const targetClassName = (_h = body.className) !== null && _h !== void 0 ? _h : profile.className;
            const resolvedClassId = yield resolveClassId(body.classId || targetClassName, createdBy.instituteId);
            const targetSectionInput = (_j = body.sectionId) !== null && _j !== void 0 ? _j : profile.sectionId;
            const resolvedSectionId = yield resolveSectionId(targetSectionInput, resolvedClassId || "", createdBy.instituteId);
            const targetSession = (_k = body.session) !== null && _k !== void 0 ? _k : profile.session;
            // Check roll number uniqueness if class, section, session, or rollNumber is being updated
            if (targetRollNumber !== profile.rollNumber ||
                targetClassName !== profile.className ||
                resolvedSectionId !== profile.sectionId ||
                targetSession !== profile.session) {
                const sectionRecord = yield Section_modal_1.default.findOne({
                    where: { sectionId: resolvedSectionId },
                });
                const sectionLabel = (sectionRecord === null || sectionRecord === void 0 ? void 0 : sectionRecord.sectionName) || resolvedSectionId;
                const rollExists = yield Student_modal_1.default.findOne({
                    where: {
                        instituteId: createdBy.instituteId,
                        rollNumber: targetRollNumber,
                        className: targetClassName,
                        sectionId: resolvedSectionId,
                        session: targetSession,
                        id: { [sequelize_2.Op.ne]: profile.id },
                    },
                });
                if (rollExists) {
                    yield t.rollback();
                    return {
                        error: true,
                        statusCode: http_status_1.default.CONFLICT,
                        message: `Roll number ${targetRollNumber} already exists in ${targetClassName} Section ${sectionLabel} for session ${targetSession}.`,
                    };
                }
            }
            yield profile.update({
                rollNumber: targetRollNumber,
                fatherName: (_l = body.fatherName) !== null && _l !== void 0 ? _l : profile.fatherName,
                gender: (_m = body.gender) !== null && _m !== void 0 ? _m : profile.gender,
                sectionId: resolvedSectionId,
                className: (_o = body.className) !== null && _o !== void 0 ? _o : profile.className,
                classId: resolvedClassId,
                session: (_p = body.session) !== null && _p !== void 0 ? _p : profile.session,
                address: (_q = body.address) !== null && _q !== void 0 ? _q : profile.address,
                dob: (_r = body.dob) !== null && _r !== void 0 ? _r : profile.dob,
                aadhar: (_s = body.aadhar) !== null && _s !== void 0 ? _s : profile.aadhar,
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
                const emailExists = yield User_modal_1.default.findOne({
                    where: { emailId: s.email },
                });
                const phoneExists = yield User_modal_1.default.findOne({
                    where: { phoneNumber: s.mobile },
                });
                const rollExists = yield Student_modal_1.default.findOne({
                    where: {
                        instituteId,
                        rollNumber: s.rollNumber,
                        className: s.className,
                        sectionId: s.sectionId,
                        session: s.session,
                    },
                });
                if (emailExists || phoneExists || rollExists) {
                    skipped++;
                    continue;
                }
                // Resolve classId from Class table
                const resolvedClassId = yield resolveClassId(s.classId || s.className, instituteId);
                // Resolve sectionId from Section table
                const resolvedSectionId = yield resolveSectionId(s.sectionId, resolvedClassId || "", instituteId);
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
                    classId: resolvedClassId,
                    rollNumber: s.rollNumber,
                    className: s.className,
                    sectionId: resolvedSectionId,
                    session: s.session,
                    fatherName: s.fatherName || "Not provided",
                    gender: s.gender || "other",
                    dob: new Date(s.dob || "2000-01-01"),
                    aadhar: s.aadhar || "000000000000",
                    address: s.address || "Not provided",
                }, { transaction: t });
                created++;
            }
            catch (err) {
                errors.push(`Row ${created + skipped + 1}: Failed — ${(err === null || err === void 0 ? void 0 : err.message) || err}`);
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
