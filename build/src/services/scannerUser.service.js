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
const ScannerProfile_modal_1 = __importDefault(require("../modals/ScannerProfile.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const helper_1 = __importDefault(require("../utils/helper"));
const sequelize_1 = require("../config/sequelize");
const sequelize_2 = require("sequelize");
// ─── CREATE SCANNER ───────────────────────────────────────────────────────────
const createScanner = (body, files, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
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
            where: { emailId: body.emailId || body.email },
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
            where: { phoneNumber: body.phoneNumber || body.mobile },
        });
        if (phoneExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Phone number is already registered.",
            };
        }
        // 4. Find SCANNER role
        const scannerRole = yield Role_modal_1.default.findOne({ where: { role: "SCANNER" } });
        if (!scannerRole) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
                message: "SCANNER role not found. Please seed roles.",
            };
        }
        // 5. Profile photo
        const profileUrl = ((_a = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _a === void 0 ? void 0 : _a[0])
            ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
            : null;
        // 6. Create user record
        const plainPassword = body.password || (yield helper_1.default.generatePassword());
        const encryptedPassword = yield encryption_1.default.encryptPassword(plainPassword);
        const userId = yield helper_1.default.generateUserId();
        const newUser = yield User_modal_1.default.create({
            userId,
            userName: `${body.firstName} ${body.lastName}`,
            emailId: body.emailId || body.email,
            phoneNumber: body.phoneNumber || body.mobile,
            password: encryptedPassword,
            roleId: scannerRole.id,
            instituteId,
            status: 1,
        }, { transaction: t });
        // 7. Create scanner profile record
        yield ScannerProfile_modal_1.default.create({
            userId: newUser.userId,
            instituteId,
            address: body.address || null,
            dob: body.dob ? new Date(body.dob) : null,
            gender: body.gender || null,
            aadhar: body.aadhar || null,
            profileUrl,
        }, { transaction: t });
        // 8. Commit
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Scanner created successfully.",
            data: {
                userId: newUser.userId,
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
// ─── GET ALL SCANNERS ─────────────────────────────────────────────────────────
const getAllScanners = (createdBy, query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { search = "" } = query;
        const scannerRole = yield Role_modal_1.default.findOne({ where: { role: "SCANNER" } });
        const where = {
            instituteId: createdBy.instituteId,
            roleId: scannerRole === null || scannerRole === void 0 ? void 0 : scannerRole.id,
        };
        if (search) {
            where[sequelize_2.Op.or] = [
                { userName: { [sequelize_2.Op.iLike]: `%${search}%` } },
                { emailId: { [sequelize_2.Op.iLike]: `%${search}%` } },
            ];
        }
        const scanners = yield User_modal_1.default.findAll({
            where,
            include: [
                { model: Role_modal_1.default, as: "role" },
                { model: ScannerProfile_modal_1.default, as: "scannerProfile", required: false },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
            order: [["userName", "ASC"]],
        });
        const result = scanners.map((u) => {
            var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
            const [first, ...lastParts] = u.userName ? u.userName.split(" ") : ["Scanner"];
            const last = lastParts.join(" ");
            return {
                userId: u.userId,
                firstName: first,
                lastName: last,
                userName: u.userName,
                emailId: u.emailId,
                phoneNumber: u.phoneNumber,
                status: u.status,
                instituteId: u.instituteId,
                address: (_b = (_a = u.scannerProfile) === null || _a === void 0 ? void 0 : _a.address) !== null && _b !== void 0 ? _b : null,
                dob: (_d = (_c = u.scannerProfile) === null || _c === void 0 ? void 0 : _c.dob) !== null && _d !== void 0 ? _d : null,
                gender: (_f = (_e = u.scannerProfile) === null || _e === void 0 ? void 0 : _e.gender) !== null && _f !== void 0 ? _f : null,
                aadhar: (_h = (_g = u.scannerProfile) === null || _g === void 0 ? void 0 : _g.aadhar) !== null && _h !== void 0 ? _h : null,
                profileUrl: (_k = (_j = u.scannerProfile) === null || _j === void 0 ? void 0 : _j.profileUrl) !== null && _k !== void 0 ? _k : null,
            };
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Scanners fetched successfully.",
            data: {
                scanners: result,
                total: result.length,
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
// ─── GET ONE SCANNER ──────────────────────────────────────────────────────────
const getScannerById = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const scanner = yield User_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
            include: [
                { model: Role_modal_1.default, as: "role" },
                { model: ScannerProfile_modal_1.default, as: "scannerProfile" },
            ],
            attributes: { exclude: ["password", "refreshToken"] },
        });
        if (!scanner) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Scanner not found.",
            };
        }
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Scanner fetched successfully.",
            data: scanner,
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
// ─── UPDATE SCANNER ───────────────────────────────────────────────────────────
const updateScanner = (userId, body, files, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    var _b, _c, _d, _e, _f;
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
                message: "Scanner not found.",
            };
        }
        const profile = yield ScannerProfile_modal_1.default.findOne({ where: { userId } });
        // Update user
        yield user.update({
            userName: body.firstName && body.lastName
                ? `${body.firstName} ${body.lastName}`
                : user.userName,
            phoneNumber: (_b = body.phoneNumber) !== null && _b !== void 0 ? _b : user.phoneNumber,
            status: body.status !== undefined ? parseInt(body.status, 10) : user.status,
        }, { transaction: t });
        // Update profile
        if (profile) {
            const profileUrl = ((_c = files === null || files === void 0 ? void 0 : files.profilePhoto) === null || _c === void 0 ? void 0 : _c[0])
                ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
                : profile.profileUrl;
            yield profile.update({
                address: (_d = body.address) !== null && _d !== void 0 ? _d : profile.address,
                dob: body.dob ? new Date(body.dob) : profile.dob,
                gender: (_e = body.gender) !== null && _e !== void 0 ? _e : profile.gender,
                aadhar: (_f = body.aadhar) !== null && _f !== void 0 ? _f : profile.aadhar,
                profileUrl,
            }, { transaction: t });
        }
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Scanner updated successfully.",
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
// ─── SOFT DELETE SCANNER ──────────────────────────────────────────────────────
const deleteScanner = (userId, createdBy) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const user = yield User_modal_1.default.findOne({
            where: { userId, instituteId: createdBy.instituteId },
        });
        if (!user) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Scanner not found.",
            };
        }
        yield user.update({ status: 0 });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Scanner deactivated successfully.",
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
    createScanner,
    getAllScanners,
    getScannerById,
    updateScanner,
    deleteScanner,
};
