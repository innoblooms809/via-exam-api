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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_status_1 = __importDefault(require("http-status"));
const User_model_1 = __importDefault(require("../../models/User.model"));
const Role_model_1 = __importDefault(require("../../models/Role.model"));
const encryption_1 = __importDefault(require("../../utils/encryption")); // reuse your existing utility
const helper_1 = __importDefault(require("../../utils/helper")); // reuse your existing utility
const exclude_1 = __importDefault(require("../../utils/exclude")); // reuse your existing utility
const sequelize_1 = require("sequelize");
const Institute_model_1 = __importDefault(require("../../models/Institute.model"));
const UserPresenceSession_model_1 = __importDefault(require("../../models/UserPresenceSession.model"));
const activityLogger_1 = require("../../utils/activityLogger");
const TeacherProfile_model_1 = __importDefault(require("../../models/TeacherProfile.model"));
const Student_model_1 = __importDefault(require("../../models/Student.model"));
const ScannerProfile_model_1 = __importDefault(require("../../models/ScannerProfile.model"));
const Section_model_1 = __importDefault(require("../../models/Section.model"));
const idGenerator_1 = require("../../utils/idGenerator");
// ─── Constants ───────────────────────────────────────────────────────────────
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 5;
// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * Fetch ViaExam user by emailId — mirrors your getUserByEmail() pattern
 */
const getViaExamUserByEmail = (emailId, instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    const where = {
        emailId: {
            [sequelize_1.Op.iLike]: emailId,
        },
    };
    if (instituteId) {
        where.instituteId = instituteId;
    }
    else if (instituteId === null) {
        where.instituteId = { [sequelize_1.Op.is]: null };
    }
    return User_model_1.default.findOne({
        include: [
            {
                model: Role_model_1.default,
                as: "role",
            },
        ],
        where,
    });
});
/**
 * Fetch ViaExam user by phoneNumber — mirrors your getUserByMobile() pattern
 */
const getViaExamUserByMobile = (phoneNumber) => __awaiter(void 0, void 0, void 0, function* () {
    return User_model_1.default.findOne({
        include: [
            {
                model: Role_model_1.default,
                as: "role",
            },
        ],
        where: { phoneNumber: phoneNumber },
    });
});
// ─── Service Functions ────────────────────────────────────────────────────────
/**
 * Create Super Admin user
 * Called once during initial setup — mirrors your userCreate() pattern
 */
const viaExamUserCreate = (req) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const conflictFields = [];
        const existUserEmail = yield getViaExamUserByEmail(req.body.emailId);
        const existUserMobile = yield getViaExamUserByMobile(req.body.phoneNumber);
        if (existUserEmail)
            conflictFields.push("email");
        if (existUserMobile)
            conflictFields.push("mobile");
        if (conflictFields.length > 0) {
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                data: {},
                message: `This ${conflictFields.join(" & ")} is already registered.`,
            };
        }
        // Reuse your existing helpers
        const password = yield helper_1.default.generatePassword();
        const encryptedPassword = yield encryption_1.default.encryptPassword(password);
        const userId = (0, idGenerator_1.newId)("user");
        // Only these fields come from the request; password, ids and lockout state never do.
        const { userName, emailId, phoneNumber, roleId, instituteId } = req.body;
        const newUser = yield User_model_1.default.create({
            userId,
            userName,
            emailId,
            phoneNumber,
            roleId,
            instituteId: instituteId || null,
            password: encryptedPassword,
            status: 1,
        });
        const _a = newUser.toJSON(), { password: _ } = _a, userResponse = __rest(_a, ["password"]);
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            data: userResponse,
            password,
            message: "ViaExam user created successfully.",
        };
    }
    catch (e) {
        console.error(e);
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            data: {},
            message: `Something went wrong: ${e.message}`,
        };
    }
});
/**
 * ViaExam login — mirrors your userLogin() pattern exactly.
 * type 1 = email login, type 2 = mobile login
 * Adds: account lockout, status checks
 */
const viaExamUserLogin = (slug, emailId, password) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c;
    try {
        console.log("EMAIL RECEIVED:", emailId);
        let instituteId = null;
        if (slug) {
            const institute = yield Institute_model_1.default.findOne({ where: { slug } });
            if (!institute) {
                return {
                    error: true,
                    statusCode: http_status_1.default.BAD_REQUEST,
                    message: "Invalid institute.",
                };
            }
            instituteId = institute.instituteId;
        }
        const user = yield getViaExamUserByEmail(emailId, instituteId);
        console.log("USER FOUND:", user === null || user === void 0 ? void 0 : user.emailId);
        console.log("HASHED PASSWORD:", user === null || user === void 0 ? void 0 : user.password);
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid credentials.",
            };
        }
        // Lock check (DISABLED)
        /*
        if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
          return {
            error: true,
            statusCode: httpStatus.TOO_MANY_REQUESTS,
            message: "Account is locked.",
          };
        }
        */
        const isMatch = yield encryption_1.default.isPasswordMatch(password, user.password);
        if (!isMatch) {
            /* Login attempts lock logic disabled
            const attempts = (user.loginAttempts || 0) + 1;
      
            if (attempts >= MAX_LOGIN_ATTEMPTS) {
              await UserModal.update(
                {
                  loginAttempts: attempts,
                  lockedUntil: new Date(
                    Date.now() + LOCK_DURATION_SECONDS * 1000
                  ),
                },
                { where: { userId: user.userId } },
              );
            } else {
              await UserModal.update(
                { loginAttempts: attempts },
                { where: { userId: user.userId } },
              );
            }
            */
            return {
                error: true,
                statusCode: http_status_1.default.BAD_REQUEST,
                message: "Invalid credentials.",
            };
        }
        // Status checks come after the password, so they don't reveal which accounts exist.
        // A suspended institute blocks all of its users (suspension marks them 2), so say
        // that rather than blaming the person's own account.
        if (user.instituteId) {
            const userInstitute = yield Institute_model_1.default.findOne({ where: { instituteId: user.instituteId }, attributes: ["status", "isDeleted"] });
            if (!userInstitute || userInstitute.isDeleted || Number(userInstitute.status) !== 1) {
                return {
                    error: true,
                    statusCode: http_status_1.default.FORBIDDEN,
                    message: "Your institute's ViaExam access is suspended. Contact the ViaExam team.",
                };
            }
        }
        if (user.status === 0) {
            return {
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Your account is inactive.",
            };
        }
        if (user.status === 2) {
            return {
                error: true,
                statusCode: http_status_1.default.UNAUTHORIZED,
                message: "Account suspended.",
            };
        }
        // Reset lock info after successful login
        yield User_model_1.default.update({
            loginAttempts: 0,
            lockedUntil: null,
            lastLoginAt: new Date(),
        }, { where: { userId: user.userId } });
        // Log Activity & Update Presence
        const now = new Date();
        let presenceSession = yield UserPresenceSession_model_1.default.findOne({ where: { userId: user.userId } });
        if (presenceSession) {
            presenceSession.presenceStatus = "ONLINE";
            presenceSession.lastActivityAt = now;
            presenceSession.lastLoginAt = now;
            presenceSession.currentActivity = "Active in Portal";
            yield presenceSession.save();
        }
        else {
            yield UserPresenceSession_model_1.default.create({
                userId: user.userId,
                role: ((_b = user.role) === null || _b === void 0 ? void 0 : _b.role) || "USER",
                instituteId: user.instituteId || null,
                presenceStatus: "ONLINE",
                currentActivity: "Active in Portal",
                lastActivityAt: now,
                lastLoginAt: now,
            });
        }
        yield (0, activityLogger_1.logActivity)({
            userId: user.userId,
            role: ((_c = user.role) === null || _c === void 0 ? void 0 : _c.role) || "USER",
            instituteId: user.instituteId || null,
            eventType: "LOGIN_SUCCESS",
            currentActivity: "Logged In",
        });
        const userResponse = (0, exclude_1.default)(user.toJSON(), ["password", "refreshToken"]);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: {
                user: userResponse,
            },
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.BAD_REQUEST,
            message: e.message,
        };
    }
});
/**
 * Logout — store/clear refresh token (mirrors your token invalidation pattern)
 */
const viaExamUserLogout = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    var _d;
    try {
        const user = yield User_model_1.default.findOne({
            include: [{ model: Role_model_1.default, as: "role" }],
            where: { userId },
        });
        yield User_model_1.default.update({ refreshToken: null }, { where: { userId } });
        // Instantly update active presence session to OFFLINE
        const logoutTime = new Date();
        const presenceSession = yield UserPresenceSession_model_1.default.findOne({ where: { userId } });
        if (presenceSession) {
            presenceSession.presenceStatus = "OFFLINE";
            presenceSession.currentActivity = "Logged Out";
            presenceSession.lastLogoutAt = logoutTime;
            yield presenceSession.save();
        }
        if (user) {
            yield (0, activityLogger_1.logActivity)({
                userId: user.userId,
                role: ((_d = user.role) === null || _d === void 0 ? void 0 : _d.role) || "USER",
                instituteId: user.instituteId || null,
                eventType: "LOGOUT",
                currentActivity: "Logged Out",
            });
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: {},
            message: "Logged out successfully.",
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: `Something went wrong: ${e.message}`,
        };
    }
});
/**
 * Get ViaExam user profile by userId
 */
const viaExamGetProfile = (userId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield User_model_1.default.findOne({
            include: [
                { model: Role_model_1.default, as: "role" },
                { model: Institute_model_1.default, as: "institute" },
            ],
            where: { userId },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                data: {},
                message: "User not found.",
            };
        }
        const userResponse = (0, exclude_1.default)(user.toJSON(), ["password", "refreshToken"]);
        // Fetch role-specific details
        const teacherProfile = yield TeacherProfile_model_1.default.findOne({ where: { userId } }).catch(() => null);
        if (teacherProfile) {
            userResponse.teacherProfile = teacherProfile.toJSON();
            userResponse.qualification = teacherProfile.qualification;
            userResponse.specialization = teacherProfile.specialization;
            userResponse.specialSubject = teacherProfile.specialization;
            userResponse.teacherType = teacherProfile.teacherType;
            userResponse.experience = teacherProfile.experience;
            userResponse.joiningDate = teacherProfile.joiningDate;
            userResponse.isExaminer = teacherProfile.isExaminer;
            userResponse.examinerSince = teacherProfile.examinerSince;
            if (teacherProfile.dob)
                userResponse.dob = teacherProfile.dob;
            if (teacherProfile.address)
                userResponse.address = teacherProfile.address;
        }
        const studentProfile = yield Student_model_1.default.findOne({ where: { userId } }).catch(() => null);
        if (studentProfile) {
            userResponse.studentProfile = studentProfile.toJSON();
            userResponse.className = studentProfile.className;
            userResponse.sectionId = studentProfile.sectionId;
            userResponse.sectionName = studentProfile.sectionId;
            if (studentProfile.sectionId) {
                const sec = yield Section_model_1.default.findOne({ where: { sectionId: studentProfile.sectionId } }).catch(() => null);
                if (sec) {
                    userResponse.sectionName = sec.sectionName;
                    userResponse.section = sec.sectionName;
                }
            }
            userResponse.rollNumber = studentProfile.rollNumber;
            userResponse.fatherName = studentProfile.fatherName;
            userResponse.session = studentProfile.session;
            userResponse.aadhar = studentProfile.aadhar;
            if (studentProfile.gender)
                userResponse.gender = studentProfile.gender;
            if (studentProfile.dob)
                userResponse.dob = studentProfile.dob;
            if (studentProfile.address)
                userResponse.address = studentProfile.address;
        }
        const scannerProfile = yield ScannerProfile_model_1.default.findOne({ where: { userId } }).catch(() => null);
        if (scannerProfile) {
            userResponse.scannerProfile = scannerProfile.toJSON();
            if (scannerProfile.aadhar)
                userResponse.aadhar = scannerProfile.aadhar;
            if (scannerProfile.gender)
                userResponse.gender = scannerProfile.gender;
            if (scannerProfile.dob)
                userResponse.dob = scannerProfile.dob;
            if (scannerProfile.address)
                userResponse.address = scannerProfile.address;
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: userResponse,
            message: "Profile fetched successfully.",
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: e.message,
        };
    }
});
/**
 * Update ViaExam user profile by userId (email ID cannot be updated)
 */
const viaExamUpdateProfile = (userId, body, files) => __awaiter(void 0, void 0, void 0, function* () {
    var _e, _f, _g, _h, _j, _k, _l, _m, _o, _p;
    try {
        const user = yield User_model_1.default.findOne({
            include: [{ model: Role_model_1.default, as: "role" }],
            where: { userId },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                data: {},
                message: "User not found.",
            };
        }
        const updates = {};
        // 1. Name update
        if (body.userName || body.name || body.firstName || body.lastName) {
            const first = (_e = body.firstName) !== null && _e !== void 0 ? _e : "";
            const last = (_f = body.lastName) !== null && _f !== void 0 ? _f : "";
            const fullName = (body.userName || body.name || `${first} ${last}`).trim();
            if (fullName) {
                updates.userName = fullName;
            }
        }
        // 2. Phone update
        if (body.phoneNumber || body.mobile || body.phone) {
            const phone = (body.phoneNumber || body.mobile || body.phone).trim();
            if (phone && phone !== user.phoneNumber) {
                const phoneExists = yield User_model_1.default.findOne({
                    where: {
                        phoneNumber: phone,
                        userId: { [sequelize_1.Op.ne]: user.userId },
                    },
                });
                if (phoneExists) {
                    return {
                        error: true,
                        statusCode: http_status_1.default.CONFLICT,
                        data: {},
                        message: "Phone number is already registered to another user.",
                    };
                }
                updates.phoneNumber = phone;
            }
        }
        // 3. Profile Photo upload
        const uploadedFile = ((_g = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _g === void 0 ? void 0 : _g[0]) || ((_h = files === null || files === void 0 ? void 0 : files.avatar) === null || _h === void 0 ? void 0 : _h[0]);
        if (uploadedFile) {
            updates.profileUrl = `/${uploadedFile.path.replace(/\\/g, "/")}`;
        }
        else if (body.profileUrl || body.profileImage) {
            // Only an https image URL or a path we serve ourselves — never javascript:/data: URLs.
            const candidate = String(body.profileUrl || body.profileImage).trim();
            const isOwnUpload = /^\/(v1\/)?uploads\/[A-Za-z0-9/_.-]+$/.test(candidate) && !candidate.includes("..");
            const isHttpsUrl = /^https:\/\/[^\s"'<>]+$/i.test(candidate) && candidate.length <= 2048;
            if (!isOwnUpload && !isHttpsUrl) {
                return { error: true, statusCode: http_status_1.default.BAD_REQUEST, data: {}, message: "Profile photo must be an uploaded image or an https link." };
            }
            updates.profileUrl = candidate;
        }
        // 4. Update Teacher Profile if provided/applicable
        const teacherProfile = yield TeacherProfile_model_1.default.findOne({ where: { userId } }).catch(() => null);
        if (teacherProfile || ((_k = (_j = user.role) === null || _j === void 0 ? void 0 : _j.role) === null || _k === void 0 ? void 0 : _k.toLowerCase()) === "teacher") {
            const teacherUpdates = {};
            if (body.qualification !== undefined)
                teacherUpdates.qualification = body.qualification;
            if (body.specialization !== undefined || body.specialSubject !== undefined) {
                teacherUpdates.specialization = body.specialization || body.specialSubject;
            }
            if (body.teacherType !== undefined || body.designation !== undefined) {
                teacherUpdates.teacherType = body.teacherType || body.designation;
            }
            if (body.experience !== undefined)
                teacherUpdates.experience = body.experience;
            if (body.joiningDate !== undefined)
                teacherUpdates.joiningDate = body.joiningDate;
            if (body.address !== undefined)
                teacherUpdates.address = body.address;
            if (body.dob !== undefined)
                teacherUpdates.dob = body.dob;
            if (Object.keys(teacherUpdates).length > 0) {
                if (teacherProfile) {
                    yield teacherProfile.update(teacherUpdates);
                }
                else if (user.instituteId) {
                    yield TeacherProfile_model_1.default.create({
                        userId,
                        instituteId: user.instituteId,
                        teacherType: teacherUpdates.teacherType || "Teacher",
                        qualification: teacherUpdates.qualification || "Graduate",
                        specialization: teacherUpdates.specialization || null,
                        experience: teacherUpdates.experience || null,
                        address: teacherUpdates.address || null,
                        joiningDate: teacherUpdates.joiningDate || new Date(),
                        dob: teacherUpdates.dob || new Date(),
                        isExaminer: false,
                    }).catch(() => null);
                }
            }
        }
        // 5. Update Student Profile if provided/applicable
        const studentProfile = yield Student_model_1.default.findOne({ where: { userId } }).catch(() => null);
        if (studentProfile || ((_m = (_l = user.role) === null || _l === void 0 ? void 0 : _l.role) === null || _m === void 0 ? void 0 : _m.toLowerCase()) === "student") {
            const studentUpdates = {};
            if (body.fatherName !== undefined)
                studentUpdates.fatherName = body.fatherName;
            if (body.rollNumber !== undefined)
                studentUpdates.rollNumber = body.rollNumber;
            if (body.className !== undefined)
                studentUpdates.className = body.className;
            if (body.sectionId !== undefined)
                studentUpdates.sectionId = body.sectionId;
            if (body.session !== undefined)
                studentUpdates.session = body.session;
            if (body.aadhar !== undefined)
                studentUpdates.aadhar = body.aadhar;
            if (body.address !== undefined)
                studentUpdates.address = body.address;
            if (body.dob !== undefined)
                studentUpdates.dob = body.dob;
            if (body.gender !== undefined)
                studentUpdates.gender = body.gender;
            if (Object.keys(studentUpdates).length > 0) {
                if (studentProfile) {
                    yield studentProfile.update(studentUpdates);
                }
                else if (user.instituteId) {
                    yield Student_model_1.default.create({
                        userId,
                        instituteId: user.instituteId,
                        rollNumber: studentUpdates.rollNumber || "STU-001",
                        className: studentUpdates.className || "Standard",
                        sectionId: studentUpdates.sectionId || "A",
                        session: studentUpdates.session || "2024-2025",
                        fatherName: studentUpdates.fatherName || "—",
                        gender: studentUpdates.gender || "—",
                        dob: studentUpdates.dob || new Date(),
                        aadhar: studentUpdates.aadhar || "—",
                        address: studentUpdates.address || "—",
                    }).catch(() => null);
                }
            }
        }
        // 6. Update Scanner Profile if provided/applicable
        const scannerProfile = yield ScannerProfile_model_1.default.findOne({ where: { userId } }).catch(() => null);
        if (scannerProfile || ((_p = (_o = user.role) === null || _o === void 0 ? void 0 : _o.role) === null || _p === void 0 ? void 0 : _p.toLowerCase()) === "scanner") {
            const scannerUpdates = {};
            if (body.address !== undefined)
                scannerUpdates.address = body.address;
            if (body.dob !== undefined)
                scannerUpdates.dob = body.dob;
            if (body.gender !== undefined)
                scannerUpdates.gender = body.gender;
            if (body.aadhar !== undefined)
                scannerUpdates.aadhar = body.aadhar;
            if (Object.keys(scannerUpdates).length > 0) {
                if (scannerProfile) {
                    yield scannerProfile.update(scannerUpdates);
                }
                else if (user.instituteId) {
                    yield ScannerProfile_model_1.default.create({
                        userId,
                        instituteId: user.instituteId,
                        address: scannerUpdates.address || null,
                        dob: scannerUpdates.dob || null,
                        gender: scannerUpdates.gender || null,
                        aadhar: scannerUpdates.aadhar || null,
                    }).catch(() => null);
                }
            }
        }
        if (Object.keys(updates).length > 0) {
            yield user.update(updates);
        }
        // Re-fetch full enriched profile data
        const fullProfileRes = yield viaExamGetProfile(userId);
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            data: fullProfileRes.data,
            message: "Profile updated successfully.",
        };
    }
    catch (e) {
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            data: {},
            message: e.message,
        };
    }
});
exports.default = {
    viaExamUserCreate,
    viaExamUserLogin,
    viaExamUserLogout,
    viaExamGetProfile,
    viaExamUpdateProfile,
    getViaExamUserByEmail,
};
