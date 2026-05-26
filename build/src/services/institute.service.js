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
const Institute_modal_1 = __importDefault(require("../modals/Institute.modal"));
const User_modal_1 = __importDefault(require("../modals/User.modal"));
const Role_modal_1 = __importDefault(require("../modals/Role.modal"));
const encryption_1 = __importDefault(require("../utils/encryption"));
const helper_1 = __importDefault(require("../utils/helper"));
const exclude_1 = __importDefault(require("../utils/exclude"));
const sequelize_1 = require("../config/sequelize");
const sequelize_2 = require("sequelize");
const mailHelper_1 = require("../utils/mailHelper");
const config_1 = __importDefault(require("../config/config"));
// ------------CREATE INSTITUTE + ADMIN USER IN ONE TRANSACTION----------------
const registerInstitute = (body, files) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e;
    // Use a transaction — if admin user creation fails, institute also rolls back
    const t = yield sequelize_1.sequelize.transaction();
    try {
        // 1. Check slug uniqueness
        const slugExists = yield Institute_modal_1.default.findOne({ where: { slug: body.slug } });
        if (slugExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "This slug is already taken. Choose a different institute name.",
            };
        }
        // 2. Check institute contact email uniqueness
        const contactEmailExists = yield Institute_modal_1.default.findOne({
            where: { contactEmail: body.contactEmail },
        });
        if (contactEmailExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Institute contact email is already in use.",
            };
        }
        // 2b. Check institute contact phone uniqueness
        const contactPhoneExists = yield Institute_modal_1.default.findOne({
            where: { contactPhone: body.contactPhone },
        });
        if (contactPhoneExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Institute contact phone is already in use.",
            };
        }
        // 3. Check admin email uniqueness
        const emailExists = yield User_modal_1.default.findOne({
            where: { emailId: body.adminEmail },
        });
        if (emailExists) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message: "Admin email is already registered.",
            };
        }
        // 5. Get file paths from multer
        const logoUrl = ((_a = files === null || files === void 0 ? void 0 : files.logo) === null || _a === void 0 ? void 0 : _a[0])
            ? `/${files.logo[0].path.replace(/\\/g, "/")}`
            : null;
        const bannerUrl = ((_b = files === null || files === void 0 ? void 0 : files.banner) === null || _b === void 0 ? void 0 : _b[0])
            ? `/${files.banner[0].path.replace(/\\/g, "/")}`
            : null;
        // 6. Calculate trial end date
        const trialDays = parseInt(body.trialDays) || 0;
        const trialEndsAt = trialDays > 0
            ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
            : null;
        // 7. Generate institute ID
        const instituteId = yield helper_1.default.generateUserId(); // reuse your ID generator
        // 8. Create Institute record
        const institute = yield Institute_modal_1.default.create({
            instituteId,
            instituteName: body.instituteName,
            instituteType: body.instituteType,
            boardType: body.boardType,
            registrationNumber: body.registrationNumber || null,
            establishedYear: body.establishedYear || null,
            websiteUrl: body.websiteUrl || null,
            slug: body.slug,
            contactPersonName: body.contactPersonName,
            contactEmail: body.contactEmail,
            contactPhone: body.contactPhone,
            alternatePhone: body.alternatePhone || null,
            addressLine1: body.addressLine1,
            addressLine2: body.addressLine2 || null,
            city: body.city,
            state: body.state,
            pincode: body.pincode,
            plan: body.plan,
            trialDays,
            trialEndsAt,
            logoUrl,
            bannerUrl,
            status: 1,
        }, { transaction: t });
        // 9. Find admin role
        const adminRole = yield Role_modal_1.default.findOne({ where: { role: "ADMIN" } });
        if (!adminRole) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
                message: "Admin role not found. Please seed roles first.",
            };
        }
        // 10. Create Admin user tied to this institute
        const encryptedPassword = yield encryption_1.default.encryptPassword(body.adminPassword);
        const adminUserId = yield helper_1.default.generateUserId();
        const adminUser = yield User_modal_1.default.create({
            userId: adminUserId,
            userName: `${body.adminFirstName} ${body.adminLastName}`,
            emailId: body.adminEmail,
            phoneNumber: body.adminPhone,
            password: encryptedPassword,
            roleId: adminRole.id,
            instituteId: institute.instituteId,
            status: 1,
        }, { transaction: t });
        // 10. All good — commit
        yield t.commit();
        const adminResponse = (0, exclude_1.default)(adminUser.toJSON(), [
            "password",
            "refreshToken",
        ]);
        // 11. Send credentials email to admin
        // const loginUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3040"}/${
        //   body.slug
        // }/auth/signin`;
        const loginUrl = `${config_1.default.frontendUrl}/${body.slug}/auth/signin`;
        yield (0, mailHelper_1.sendAdminCredentials)({
            adminName: `${body.adminFirstName} ${body.adminLastName}`,
            adminEmail: body.adminEmail,
            adminPassword: body.adminPassword,
            instituteName: body.instituteName,
            loginUrl,
            plan: body.plan,
        });
        return {
            error: false,
            statusCode: http_status_1.default.CREATED,
            message: "Institute registered successfully.",
            data: {
                institute,
                admin: adminResponse,
                // loginUrl: `${process.env.FRONTEND_URL}/${body.slug}/auth/signin`,
                loginUrl: `${(_c = process.env.FRONTEND_URL) !== null && _c !== void 0 ? _c : "http://localhost:3000"}/${body.slug}/auth/signin`,
                logoUrl,
            },
        };
    }
    catch (e) {
        yield t.rollback();
        console.error(e);
        if (e.name === "SequelizeUniqueConstraintError") {
            const field = (_e = (_d = e.errors) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.path;
            let message = "This record already exists.";
            if (field === "phoneNumber")
                message = "This phone number is already registered.";
            if (field === "emailId")
                message = "This email is already registered.";
            return {
                error: true,
                statusCode: http_status_1.default.CONFLICT,
                message,
            };
        }
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// ----------RESEND ADMIN CREDENTIALS EMAIL (IF NOT RECEIVED)----------------
const resendAdminCredentials = (instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // 1. Find institute
        const whereCondition = {
            isDeleted: false,
            [sequelize_2.Op.or]: [
                { instituteId },
                ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
            ],
        };
        const institute = yield Institute_modal_1.default.findOne({ where: whereCondition });
        if (!institute) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Institute not found.",
            };
        }
        // 2. Find admin user of this institute
        const adminRole = yield Role_modal_1.default.findOne({ where: { role: "ADMIN" } });
        const adminUser = yield User_modal_1.default.findOne({
            where: { instituteId: institute.instituteId, roleId: adminRole === null || adminRole === void 0 ? void 0 : adminRole.id },
        });
        if (!adminUser) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Admin user not found for this institute.",
            };
        }
        // 3. Generate a new password
        const newPassword = helper_1.default.generateTempPassword(); // see helper below
        const encrypted = yield encryption_1.default.encryptPassword(newPassword);
        // 4. Update password in DB
        yield adminUser.update({ password: encrypted });
        // 5. Build login URL same way as registration
        const loginUrl = `${config_1.default.frontendUrl}/${institute.slug}/auth/signin`;
        // 6. Re-send credentials email
        yield (0, mailHelper_1.sendAdminCredentials)({
            adminName: adminUser.userName,
            adminEmail: adminUser.emailId,
            adminPassword: newPassword,
            instituteName: institute.instituteName,
            loginUrl,
            plan: institute.plan,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Credentials resent to ${adminUser.emailId} successfully.`,
            data: { email: adminUser.emailId },
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
// ─── GET ALL ──────────────────────────────────────────────────────────────────
// Returns all active institutes (status != 2 deleted)
// Supports: search, pagination, plan filter
const getAllInstitutes = (query) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { page = 1, limit = 10, search = "", plan = "", status = "" } = query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        // Build where clause dynamically
        const where = {
            isDeleted: false, // soft delete filter
        };
        if (search) {
            where[sequelize_2.Op.or] = [
                { instituteName: { [sequelize_2.Op.iLike]: `%${search}%` } },
                { slug: { [sequelize_2.Op.iLike]: `%${search}%` } },
                { city: { [sequelize_2.Op.iLike]: `%${search}%` } },
                { contactEmail: { [sequelize_2.Op.iLike]: `%${search}%` } },
            ];
        }
        if (plan)
            where.plan = plan;
        if (status)
            where.status = parseInt(status);
        const { count, rows } = yield Institute_modal_1.default.findAndCountAll({
            where,
            order: [["createdAt", "DESC"]],
            limit: parseInt(limit),
            offset,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Institutes fetched successfully.",
            data: {
                institutes: rows,
                pagination: {
                    total: count,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages: Math.ceil(count / parseInt(limit)),
                },
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
//  ─── GET ONE ──────────────────────────────────────────────────────────────────
// Get single institute by instituteId
// Also returns the admin user linked to this institute
const getInstituteById = (identifier) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Build where clause — supports both numeric id (4) and instituteId (IB726935)
        const where = {
            isDeleted: false,
            [sequelize_2.Op.or]: [
                { instituteId: identifier },
                ...(isNaN(Number(identifier)) ? [] : [{ id: Number(identifier) }]),
            ],
        };
        // ✅ Using the where clause we built above (was using wrong variable before)
        const institute = yield Institute_modal_1.default.findOne({ where });
        if (!institute) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Institute not found.",
            };
        }
        // Fetch admin user linked to this institute
        const adminRole = yield Role_modal_1.default.findOne({ where: { role: "ADMIN" } });
        const adminUser = adminRole
            ? yield User_modal_1.default.findOne({
                where: {
                    instituteId: institute.instituteId,
                    roleId: adminRole.id,
                },
                attributes: { exclude: ["password", "refreshToken"] },
            })
            : null;
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Institute fetched successfully.",
            data: {
                institute,
                admin: adminUser,
            },
        };
    }
    catch (e) {
        console.error("❌ getInstituteById error:", e.message);
        return {
            error: true,
            statusCode: http_status_1.default.INTERNAL_SERVER_ERROR,
            message: `Something went wrong: ${e.message}`,
        };
    }
});
// // ─── UPDATE ───────────────────────────────────────────────────────────────────
// Update institute details + optionally update logo/banner
// Does NOT update admin credentials here (separate API for that)
const updateInstitute = (instituteId, body, files) => __awaiter(void 0, void 0, void 0, function* () {
    var _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    try {
        const whereCondition = {
            isDeleted: false,
            [sequelize_2.Op.or]: [
                { instituteId },
                ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
            ],
        };
        const institute = yield Institute_modal_1.default.findOne({ where: whereCondition });
        if (!institute) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Institute not found.",
            };
        }
        // Check slug uniqueness if slug is being changed
        if (body.slug && body.slug !== institute.slug) {
            const slugExists = yield Institute_modal_1.default.findOne({
                where: {
                    slug: body.slug,
                    instituteId: { [sequelize_2.Op.ne]: institute.instituteId }, // exclude current institute
                },
            });
            if (slugExists) {
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: "This slug is already taken.",
                };
            }
        }
        // Handle new file uploads — keep old ones if no new file sent
        if (body.contactEmail && body.contactEmail !== institute.contactEmail) {
            const contactEmailExists = yield Institute_modal_1.default.findOne({
                where: {
                    contactEmail: body.contactEmail,
                    instituteId: { [sequelize_2.Op.ne]: institute.instituteId },
                },
            });
            if (contactEmailExists) {
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: "Institute contact email is already in use.",
                };
            }
        }
        if (body.contactPhone && body.contactPhone !== institute.contactPhone) {
            const contactPhoneExists = yield Institute_modal_1.default.findOne({
                where: {
                    contactPhone: body.contactPhone,
                    instituteId: { [sequelize_2.Op.ne]: institute.instituteId },
                },
            });
            if (contactPhoneExists) {
                return {
                    error: true,
                    statusCode: http_status_1.default.CONFLICT,
                    message: "Institute contact phone is already in use.",
                };
            }
        }
        // Handle new file uploads â€” keep old ones if no new file sent
        const logoUrl = ((_f = files === null || files === void 0 ? void 0 : files.logo) === null || _f === void 0 ? void 0 : _f[0])
            ? `/${files.logo[0].path.replace(/\\/g, "/")}`
            : institute.logoUrl;
        const bannerUrl = ((_g = files === null || files === void 0 ? void 0 : files.banner) === null || _g === void 0 ? void 0 : _g[0])
            ? `/${files.banner[0].path.replace(/\\/g, "/")}`
            : institute.bannerUrl;
        // Only update fields that are sent in body
        yield institute.update({
            instituteName: (_h = body.instituteName) !== null && _h !== void 0 ? _h : institute.instituteName,
            instituteType: (_j = body.instituteType) !== null && _j !== void 0 ? _j : institute.instituteType,
            boardType: (_k = body.boardType) !== null && _k !== void 0 ? _k : institute.boardType,
            registrationNumber: (_l = body.registrationNumber) !== null && _l !== void 0 ? _l : institute.registrationNumber,
            establishedYear: (_m = body.establishedYear) !== null && _m !== void 0 ? _m : institute.establishedYear,
            websiteUrl: (_o = body.websiteUrl) !== null && _o !== void 0 ? _o : institute.websiteUrl,
            slug: (_p = body.slug) !== null && _p !== void 0 ? _p : institute.slug,
            contactPersonName: (_q = body.contactPersonName) !== null && _q !== void 0 ? _q : institute.contactPersonName,
            contactEmail: (_r = body.contactEmail) !== null && _r !== void 0 ? _r : institute.contactEmail,
            contactPhone: (_s = body.contactPhone) !== null && _s !== void 0 ? _s : institute.contactPhone,
            alternatePhone: (_t = body.alternatePhone) !== null && _t !== void 0 ? _t : institute.alternatePhone,
            addressLine1: (_u = body.addressLine1) !== null && _u !== void 0 ? _u : institute.addressLine1,
            addressLine2: (_v = body.addressLine2) !== null && _v !== void 0 ? _v : institute.addressLine2,
            city: (_w = body.city) !== null && _w !== void 0 ? _w : institute.city,
            state: (_x = body.state) !== null && _x !== void 0 ? _x : institute.state,
            pincode: (_y = body.pincode) !== null && _y !== void 0 ? _y : institute.pincode,
            plan: (_z = body.plan) !== null && _z !== void 0 ? _z : institute.plan,
            logoUrl,
            bannerUrl,
        });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Institute updated successfully.",
            data: institute,
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
// Sets isDeleted = true instead of removing from DB
// Also deactivates the linked admin user
const softDeleteInstitute = (instituteId) => __awaiter(void 0, void 0, void 0, function* () {
    const t = yield sequelize_1.sequelize.transaction();
    try {
        const whereCondition = {
            isDeleted: false,
            [sequelize_2.Op.or]: [
                { instituteId },
                ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
            ],
        };
        const institute = yield Institute_modal_1.default.findOne({ where: whereCondition });
        if (!institute) {
            yield t.rollback();
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Institute not found.",
            };
        }
        // Soft delete institute
        yield institute.update({ isDeleted: true, status: 0 }, { transaction: t });
        // Also deactivate all users of this institute
        yield User_modal_1.default.update({ status: 0 }, { where: { instituteId: institute.instituteId }, transaction: t });
        yield t.commit();
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: "Institute deleted successfully.",
            data: {},
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
// ─── TOGGLE STATUS ────────────────────────────────────────────────────────────
// Activate (status=1) or Deactivate (status=0) an institute
// Useful for suspending without deleting
const toggleInstituteStatus = (instituteId, status) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const whereCondition = {
            isDeleted: false,
            [sequelize_2.Op.or]: [
                { instituteId },
                ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
            ],
        };
        const institute = yield Institute_modal_1.default.findOne({ where: whereCondition });
        if (!institute) {
            return {
                error: true,
                statusCode: http_status_1.default.NOT_FOUND,
                message: "Institute not found.",
            };
        }
        yield institute.update({ status });
        // Also update all users of this institute
        yield User_modal_1.default.update({ status }, { where: { instituteId: institute.instituteId } });
        return {
            error: false,
            statusCode: http_status_1.default.OK,
            message: `Institute ${status === 1 ? "activated" : "deactivated"} successfully.`,
            data: institute,
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
    registerInstitute,
    getAllInstitutes,
    getInstituteById,
    updateInstitute,
    softDeleteInstitute,
    toggleInstituteStatus,
    resendAdminCredentials,
};
