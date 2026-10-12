import httpStatus from "http-status";
import Institute from "../../models/Institute.model";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import EncryptPassword from "../../utils/encryption";
import RegHelper from "../../utils/helper";
import exclude from "../../utils/exclude";
import { sequelize } from "../../config/sequelize";
import { Op } from "sequelize";
import { sendAdminCredentials } from "../../utils/mailHelper";
import config from "../../config/config";
import { destroyInstituteAsset, uploadInstituteAsset } from "../../utils/instituteStorage";
import PlanService from "../subscription/plan.service";
import SubscriptionService from "../subscription/subscription.service";
import SubscriptionNotifier, { SUBSCRIPTION_NOTIFICATION, formatDate } from "../subscription/subscriptionNotifier";
import { newId } from "../../utils/idGenerator";
import logger from "../../config/logger";
import StudentProfile from "../../models/Student.model";
import PushToken from "../../models/PushToken.model";
import Session from "../../models/Session.model";
import Class from "../../models/Class.model";
import Section from "../../models/Section.model";
import Subject from "../../models/Subject.model";
import Exam from "../../models/Exam.model";
import Scanner from "../../models/Scanner.model";
import AcademicCalendar from "../../models/AcademicCalendar.model";
import Notification from "../../models/Notification.model";
import StudentResult from "../../models/StudentResult.model";
import EvaluationAssignment from "../../models/EvaluationAssignment.model";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";


// ------------CREATE INSTITUTE + ADMIN USER IN ONE TRANSACTION----------------
const registerInstitute = async (body: any, files: any): Promise<any> => {
  // Use a transaction — if admin user creation fails, institute also rolls back
  const t = await sequelize.transaction();

  // Declared outside the try so the catch block can clean up an uploaded
  // logo if a later step (e.g. admin creation) fails. (Institutes have a logo
  // only; the banner image was removed.)
  let logoUrl: string | null = null;
  let logoPublicId: string | null = null;

  try {
    // 1. Check slug uniqueness
    const slugExists = await Institute.findOne({ where: { slug: body.slug } });
    if (slugExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message:
          "This slug is already taken. Choose a different institute name.",
      };
    }

    // 2. Check institute contact email uniqueness
    const contactEmailExists = await Institute.findOne({
      where: { contactEmail: body.contactEmail },
    });
    if (contactEmailExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Institute contact email is already in use.",
      };
    }

    // 2b. Check institute contact phone uniqueness
    const contactPhoneExists = await Institute.findOne({
      where: { contactPhone: body.contactPhone },
    });
    if (contactPhoneExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Institute contact phone is already in use.",
      };
    }

    // 3. Check admin email uniqueness (only if admin data provided)
    const hasAdminData = body.adminEmail && body.adminEmail.trim();
    if (hasAdminData) {
      const emailExists = await UserModal.findOne({
        where: { emailId: body.adminEmail },
      });
      if (emailExists) {
        await t.rollback();
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "Admin email is already registered.",
        };
      }
    }

    // 5. Generate institute ID (needed up front so uploads can be scoped by it)
    const instituteId = newId("institute");

    // 6. Upload the logo to Cloudinary, if provided (bytes already checked by verifyUploads)
    try {
      if (files?.logo?.[0]) {
        const stored = await uploadInstituteAsset({
          buffer: files.logo[0].buffer,
          instituteId,
          kind: "logo",
        });
        logoUrl = stored.url;
        logoPublicId = stored.publicId;
      }
    } catch (uploadErr: any) {
      await t.rollback();
      if (logoPublicId) await destroyInstituteAsset(logoPublicId, "register rollback");
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: `Could not store the logo: ${uploadErr?.message ?? uploadErr}`,
      };
    }

    // 7. Calculate trial end date (the plan's trial length unless the super admin set one)
    const selectedPlan = await PlanService.findPlan(String(body.plan || "").toLowerCase());
    const trialDays =
      body.trialDays !== undefined && body.trialDays !== ""
        ? Math.max(0, parseInt(body.trialDays) || 0)
        : selectedPlan?.trialDays ?? 0;
    const trialEndsAt =
      trialDays > 0
        ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
        : null;

    // 8. Create Institute record
    const institute = await Institute.create(
      {
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
        logoPublicId,
        status: 1,
      },
      { transaction: t },
    );

    // 8b. Start the institute's subscription (free trial when the plan has one)
    await SubscriptionService.createForInstitute(instituteId, String(body.plan || "").toLowerCase(), trialDays, t);

    let adminResponse = null;
    const loginUrl = `${config.frontendUrl}/${body.slug}/auth/signin`;

    // 9. Create Admin user ONLY if admin fields are provided
    if (hasAdminData) {
      const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
      if (!adminRole) {
        await t.rollback();
        if (logoPublicId) await destroyInstituteAsset(logoPublicId, "register rollback");
        return {
          error: true,
          statusCode: httpStatus.INTERNAL_SERVER_ERROR,
          message: "Admin role not found. Please seed roles first.",
        };
      }

      const encryptedPassword = await EncryptPassword.encryptPassword(
        body.adminPassword,
      );
      const adminUserId = newId("user");

      const adminUser = await UserModal.create(
        {
          userId: adminUserId,
          userName: `${body.adminFirstName} ${body.adminLastName}`,
          emailId: body.adminEmail,
          phoneNumber: body.adminPhone,
          password: encryptedPassword,
          roleId: adminRole.id,
          instituteId: institute.instituteId,
          status: 1,
        },
        { transaction: t },
      );

      adminResponse = exclude(adminUser.toJSON(), [
        "password",
        "refreshToken",
      ]);

      // Send credentials email to admin
      await sendAdminCredentials({
        adminName: `${body.adminFirstName} ${body.adminLastName}`,
        adminEmail: body.adminEmail,
        adminPassword: body.adminPassword,
        instituteName: body.instituteName,
        loginUrl,
        plan: body.plan,
      });
    }

    // All good — commit
    await t.commit();

    void SubscriptionNotifier.notifySuperAdmins(instituteId, {
      type: SUBSCRIPTION_NOTIFICATION.TRIAL_STARTED,
      title: `New institute: ${body.instituteName}`,
      message: trialDays > 0
        ? `${body.instituteName} started a ${trialDays}-day free trial on the ${selectedPlan?.name || body.plan} plan (ends ${formatDate(trialEndsAt)}).`
        : `${body.instituteName} was registered on the ${selectedPlan?.name || body.plan} plan without a trial; it needs a payment to become active.`,
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: hasAdminData
        ? "Institute registered and admin created successfully."
        : "Institute registered successfully. Admin can be added later from Add Admin page.",
      data: {
        institute,
        admin: adminResponse,
        loginUrl: `${config.frontendUrl}/${body.slug}/auth/signin`,
        logoUrl,
      },
    };
  } catch (e: any) {
    await t.rollback();
    console.error(e);
    if (logoPublicId) await destroyInstituteAsset(logoPublicId, "register rollback");

    if (e.name === "SequelizeUniqueConstraintError") {
      const field = e.errors?.[0]?.path;
      let message = "This record already exists.";
      if (field === "phoneNumber") message = "This phone number is already registered.";
      if (field === "emailId") message = "This email is already registered.";

      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message,
      };
    }

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};


// ----------RESEND ADMIN CREDENTIALS EMAIL (IF NOT RECEIVED)----------------
const resendAdminCredentials = async (instituteId: string): Promise<any> => {
  try {
    // 1. Find institute
    const whereCondition: any = {
      isDeleted: false,
      [Op.or]: [
        { instituteId },
        ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
      ],
    };
    const institute = await Institute.findOne({ where: whereCondition });

    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    // 2. Find admin user of this institute
    const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
    const adminUser = await UserModal.findOne({
      where: { instituteId: institute.instituteId, roleId: adminRole?.id },
    });

    if (!adminUser) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Admin user not found for this institute.",
      };
    }

    // 3. Fresh temporary password (generated here, emailed, never returned)
    const newPassword = RegHelper.generateTempPassword();
    const encrypted = await EncryptPassword.encryptPassword(newPassword);

    // 4. Update password in DB
    await adminUser.update({ password: encrypted });

    // 5. Build login URL same way as registration
    const loginUrl = `${config.frontendUrl}/${institute.slug}/auth/signin`;

    // 6. Re-send credentials email
    await sendAdminCredentials({
      adminName: adminUser.userName,
      adminEmail: adminUser.emailId,
      adminPassword: newPassword,       // plain — email only, never stored
      instituteName: institute.instituteName,
      loginUrl,
      plan: institute.plan,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Credentials resent to ${adminUser.emailId} successfully.`,
      data: { email: adminUser.emailId },
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ALL ──────────────────────────────────────────────────────────────────
// Returns all active institutes (status != 2 deleted)
// Supports: search, pagination, plan filter

const getAllInstitutes = async (query: any): Promise<any> => {
  try {
    const { search = "", plan = "", status = "" } = query;
    const page = Math.max(1, parseInt(query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 10));
    const offset = (page - 1) * limit;

    // Build where clause dynamically
    const where: any = {
      isDeleted: false, // soft delete filter
    };

    if (search) {
      // LIKE wildcards typed by the user are matched literally.
      const term = `%${String(search).trim().slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      where[Op.or] = [
        { instituteName: { [Op.iLike]: term } }, // iLike = case insensitive (postgres)
        { slug: { [Op.iLike]: term } },
        { city: { [Op.iLike]: term } },
        { contactEmail: { [Op.iLike]: term } },
        { contactPersonName: { [Op.iLike]: term } },
      ];
    }

    if (plan) where.plan = plan;
    if (status) where.status = parseInt(status);
    const idFilters: any[] = [];
    if (query.onlyInstituteId) idFilters.push({ instituteId: String(query.onlyInstituteId) });
    // ?hasAdmin=true|false — institutes with / without an institute admin account
    if (query.hasAdmin === "true" || query.hasAdmin === "false") {
      const role = await Role.findOne({ where: { role: "ADMIN" }, attributes: ["id"] });
      const admins = sequelize.literal(
        `(SELECT "instituteId" FROM viaexam_users WHERE "roleId" = ${Number(role?.id) || 0} AND "isDeleted" = false AND "instituteId" IS NOT NULL)`
      );
      idFilters.push({ instituteId: { [query.hasAdmin === "true" ? Op.in : Op.notIn]: admins } });
    }
    if (idFilters.length) where[Op.and] = idFilters;

    const { count, rows } = await Institute.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    // Fetch admin users for all institutes in this page
    const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
    let institutesWithAdmin = rows.map((inst) => inst.toJSON());

    if (adminRole) {
      const instituteIds = rows.map((inst) => inst.instituteId);
      const adminUsers = await UserModal.findAll({
        where: {
          instituteId: { [Op.in]: instituteIds },
          roleId: adminRole.id,
          isDeleted: false,
        },
        attributes: { exclude: ["password", "refreshToken"] },
      });

      // Build a map of instituteId → admin user
      const adminMap: Record<string, any> = {};
      for (const admin of adminUsers) {
        adminMap[admin.instituteId as string] = admin.toJSON();
      }

      // Attach admin to each institute
      institutesWithAdmin = institutesWithAdmin.map((inst: any) => ({
        ...inst,
        admin: adminMap[inst.instituteId] || null,
      }));
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Institutes fetched successfully.",
      data: {
        institutes: institutesWithAdmin,
        pagination: {
          total: count,
          page: page,
          limit: limit,
          totalPages: Math.ceil(count / limit),
        },
      },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

//  ─── GET ONE ──────────────────────────────────────────────────────────────────
// Get single institute by instituteId
// Also returns the admin user linked to this institute

const getInstituteById = async (identifier: string): Promise<any> => {
  try {


    // Build where clause — supports both numeric id (4) and instituteId (IB726935)
    const where: any = {
      isDeleted: false,
      [Op.or]: [
        { instituteId: identifier },
        ...(isNaN(Number(identifier)) ? [] : [{ id: Number(identifier) }]),
      ],
    };

    // ✅ Using the where clause we built above (was using wrong variable before)
    const institute = await Institute.findOne({ where });



    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    // Fetch admin user linked to this institute
    const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
    const adminUser = adminRole
      ? await UserModal.findOne({
        where: {
          instituteId: institute.instituteId, // ✅ use fetched institute's id
          roleId: adminRole.id,
        },
        attributes: { exclude: ["password", "refreshToken"] },
      })
      : null;

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Institute fetched successfully.",
      data: {
        institute,
        admin: adminUser,
      },
    };
  } catch (e: any) {
    console.error("❌ getInstituteById error:", e.message);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// // ─── UPDATE ───────────────────────────────────────────────────────────────────
// Update institute details + optionally replace the logo
// Does NOT update admin credentials here (separate API for that)

const updateInstitute = async (
  instituteId: string,
  body: any,
  files: any,
): Promise<any> => {
  try {
    const whereCondition: any = {
      isDeleted: false,
      [Op.or]: [
        { instituteId },
        ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
      ],
    };
    const institute = await Institute.findOne({ where: whereCondition });

    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    // Check slug uniqueness if slug is being changed
    if (body.slug && body.slug !== institute.slug) {
      const slugExists = await Institute.findOne({
        where: {
          slug: body.slug,
          instituteId: { [Op.ne]: institute.instituteId }, // exclude current institute
        },
      });
      if (slugExists) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "This slug is already taken.",
        };
      }
    }

    // Handle new file uploads — keep old ones if no new file sent
    if (body.contactEmail && body.contactEmail !== institute.contactEmail) {
      const contactEmailExists = await Institute.findOne({
        where: {
          contactEmail: body.contactEmail,
          instituteId: { [Op.ne]: institute.instituteId },
        },
      });
      if (contactEmailExists) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "Institute contact email is already in use.",
        };
      }
    }

    if (body.contactPhone && body.contactPhone !== institute.contactPhone) {
      const contactPhoneExists = await Institute.findOne({
        where: {
          contactPhone: body.contactPhone,
          instituteId: { [Op.ne]: institute.instituteId },
        },
      });
      if (contactPhoneExists) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "This phone number is already registered with another institute.",
        };
      }
    }

    // Handle new file uploads — keep old ones if no new file sent. Each
    // upload overwrites the same Cloudinary public_id as before, so there is
    // no separate asset to clean up here.
    let logoUrl = institute.logoUrl;
    let logoPublicId = institute.logoPublicId;

    try {
      if (files?.logo?.[0]) {
        const stored = await uploadInstituteAsset({
          buffer: files.logo[0].buffer,
          instituteId: institute.instituteId,
          kind: "logo",
        });
        logoUrl = stored.url;
        logoPublicId = stored.publicId;
      }
    } catch (uploadErr: any) {
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: `Could not store the logo: ${uploadErr?.message ?? uploadErr}`,
      };
    }

    // Only update fields that are sent in body
    await institute.update({
      instituteName: body.instituteName ?? institute.instituteName,
      instituteType: body.instituteType ?? institute.instituteType,
      boardType: body.boardType ?? institute.boardType,
      registrationNumber:
        body.registrationNumber ?? institute.registrationNumber,
      establishedYear: body.establishedYear ?? institute.establishedYear,
      websiteUrl: body.websiteUrl ?? institute.websiteUrl,
      slug: body.slug ?? institute.slug,
      contactPersonName: body.contactPersonName ?? institute.contactPersonName,
      contactEmail: body.contactEmail ?? institute.contactEmail,
      contactPhone: body.contactPhone ?? institute.contactPhone,
      alternatePhone: body.alternatePhone ?? institute.alternatePhone,
      addressLine1: body.addressLine1 ?? institute.addressLine1,
      addressLine2: body.addressLine2 ?? institute.addressLine2,
      city: body.city ?? institute.city,
      state: body.state ?? institute.state,
      pincode: body.pincode ?? institute.pincode,
      plan: body.plan ?? institute.plan,
      logoUrl,
      logoPublicId,
    });

    if (body.plan) {
      await SubscriptionService.syncPlanFromInstitute(institute.instituteId, body.plan);
    }

    // Update linked admin user if admin fields are sent in body
    const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
    let updatedAdmin = null;
    if (adminRole) {
      const adminUser = await UserModal.findOne({
        where: {
          instituteId: institute.instituteId,
          roleId: adminRole.id,
        },
      });

      if (adminUser) {
        const updateAdminData: any = {};
        if (body.adminFirstName || body.adminLastName) {
          const first = body.adminFirstName ?? "";
          const last = body.adminLastName ?? "";
          const newName = `${first} ${last}`.trim();
          if (newName) updateAdminData.userName = newName;
        }
        if (body.adminEmail && body.adminEmail.trim() !== "" && body.adminEmail !== adminUser.emailId) {
          const emailExists = await UserModal.findOne({
            where: {
              emailId: body.adminEmail,
              userId: { [Op.ne]: adminUser.userId },
            },
          });
          if (emailExists) {
            return {
              error: true,
              statusCode: httpStatus.CONFLICT,
              message: "Admin email is already registered to another user.",
            };
          }
          updateAdminData.emailId = body.adminEmail;
        }
        if (body.adminPhone && body.adminPhone.trim() !== "") {
          updateAdminData.phoneNumber = body.adminPhone;
        }

        if (Object.keys(updateAdminData).length > 0) {
          await adminUser.update(updateAdminData);
        }
        updatedAdmin = await UserModal.findOne({
          where: { userId: adminUser.userId },
          attributes: { exclude: ["password", "refreshToken"] },
        });
      }
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Institute updated successfully.",
      data: {
        institute,
        admin: updatedAdmin,
      },
    };
  } catch (e: any) {
    if (e.name === "SequelizeUniqueConstraintError") {
      const field = e.errors?.[0]?.path;
      let message = "This record already exists.";
      if (field === "phoneNumber" || field === "contactPhone") {
        message = "This phone number is already registered with another institute or user.";
      } else if (field === "emailId" || field === "contactEmail") {
        message = "This email address is already registered with another institute or user.";
      } else if (field === "slug") {
        message = "This URL slug is already taken.";
      }

      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message,
      };
    }
    if (e.name === "SequelizeValidationError") {
      const firstError = e.errors?.[0];
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: firstError?.message || `Validation error: ${e.message}`,
      };
    }
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── SOFT DELETE ──────────────────────────────────────────────────────────────
// Super admin only. Nothing is removed from the DB: the institute and every
// record that belongs to it — users, master data (sessions, classes, sections,
// subjects), exams, answer sheets, calendar, notifications — are flagged
// deleted in ONE transaction, so it is all or nothing. Assignments are closed,
// sign-ins are revoked (refresh tokens cleared, push tokens dropped) and the
// auth middleware refuses any token of a deleted institute from now on.

const softDeleteInstitute = async (instituteId: string): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const whereCondition: any = {
      isDeleted: false,
      [Op.or]: [
        { instituteId },
        ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
      ],
    };
    const institute = await Institute.findOne({ where: whereCondition, transaction: t, lock: t.LOCK.UPDATE });

    if (!institute) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    const scope = { where: { instituteId: institute.instituteId }, transaction: t };
    const notDeleted = { where: { instituteId: institute.instituteId, isDeleted: false }, transaction: t };
    const now = new Date();

    await institute.update({ isDeleted: true, status: 0 }, { transaction: t });

    // People: deleted and signed out everywhere.
    await UserModal.update({ status: 0, isDeleted: true, refreshToken: null } as any, notDeleted);
    await StudentProfile.update({ isActive: false }, scope);
    await PushToken.destroy(scope);

    // Master data and exam records.
    await Session.update({ isDeleted: true, isActive: false }, notDeleted);
    await Class.update({ isDeleted: true, isActive: false }, notDeleted);
    await Section.update({ isDeleted: true, isActive: false }, notDeleted);
    await Subject.update({ isDeleted: true, isActive: false }, notDeleted);
    await Exam.update({ isDeleted: true }, notDeleted);
    await Scanner.update({ isDeleted: true }, notDeleted);
    await AcademicCalendar.update({ isDeleted: true } as any, notDeleted);
    await Notification.update({ isDeleted: true }, notDeleted);
    await StudentResult.update({ isDeleted: true }, notDeleted);

    // Open work is closed, with the time it was closed.
    await EvaluationAssignment.update({ isActive: false, unassignedAt: now }, { where: { instituteId: institute.instituteId, isActive: true }, transaction: t });
    await ExamScannerAssignment.update({ isActive: false, unassignedAt: now }, { where: { instituteId: institute.instituteId, isActive: true }, transaction: t });

    await t.commit();
    logger.info(`[Institute] ${institute.instituteId} soft-deleted with all its records.`);

    // Committed — the row is kept for audit, but the storage bytes can go.
    if (institute.logoPublicId) await destroyInstituteAsset(institute.logoPublicId, "deleted institute");
    if (institute.bannerPublicId) await destroyInstituteAsset(institute.bannerPublicId, "deleted institute");

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Institute deleted successfully.",
      data: {},
    };
  } catch (e: any) {
    await t.rollback();
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── TOGGLE STATUS ────────────────────────────────────────────────────────────
// Activate (status=1) or Deactivate (status=0) an institute
// Useful for suspending without deleting

const toggleInstituteStatus = async (
  instituteId: string,
  status: number,
): Promise<any> => {
  try {
    const whereCondition: any = {
      isDeleted: false,
      [Op.or]: [
        { instituteId },
        ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
      ],
    };
    const institute = await Institute.findOne({ where: whereCondition });

    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    // Suspending an institute marks its active users 2 (suspended); re-activating
    // restores only those, so users an admin had switched off (0) stay off.
    // Institutes suspended before this rule zeroed everyone; for those (no user
    // left at 1 or 2) re-activation falls back to restoring all of them.
    await sequelize.transaction(async (t) => {
      await institute.update({ status }, { transaction: t });
      const users = { instituteId: institute.instituteId, isDeleted: false };
      if (status === 1) {
        const [restored] = await UserModal.update({ status: 1 }, { where: { ...users, status: 2 }, transaction: t });
        if (!restored) {
          const stillActive = await UserModal.count({ where: { ...users, status: 1 }, transaction: t });
          if (!stillActive) await UserModal.update({ status: 1 }, { where: { ...users, status: 0 }, transaction: t });
        }
      } else {
        await UserModal.update({ status: 2, refreshToken: null } as any, { where: { ...users, status: 1 }, transaction: t });
      }
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Institute ${status === 1 ? "activated" : "deactivated"
        } successfully.`,
      data: institute,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const getInstituteBySlug = async (slug: string): Promise<any> => {
  try {
    const institute = await Institute.findOne({
      where: {
        slug,
        isDeleted: false,
      },
      attributes: ["instituteName", "logoUrl", "slug", "status", "city"],
    });

    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Institute fetched successfully.",
      data: institute,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET CREDENTIALS ───────────────────────────────────────────────────────────
const getInstituteCredentials = async (instituteId: string): Promise<any> => {
  try {
    const whereCondition: any = {
      isDeleted: false,
      [Op.or]: [
        { instituteId },
        ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
      ],
    };
    const institute = await Institute.findOne({ where: whereCondition });

    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
    const adminUser = await UserModal.findOne({
      where: { instituteId: institute.instituteId, roleId: adminRole?.id },
    });

    if (!adminUser) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Admin user not found for this institute.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Credentials fetched successfully.",
      data: {
        adminEmail: adminUser.emailId,
      },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const addInstituteAdmin = async (instituteId: string, body: any): Promise<any> => {
  try {
    const whereCondition: any = {
      isDeleted: false,
      [Op.or]: [
        { instituteId },
        ...(isNaN(Number(instituteId)) ? [] : [{ id: Number(instituteId) }]),
      ],
    };
    const institute = await Institute.findOne({ where: whereCondition });

    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
    if (!adminRole) {
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "Admin role not found in database.",
      };
    }

    // Passwords are never chosen in the browser: a temporary one is generated here and emailed.
    // A new one is issued when the admin is created, when their email changes (the old
    // credentials went to the old address) or when `resetPassword` is set.
    const { adminFirstName, adminLastName, adminEmail, adminPhone } = body;
    const resetPassword = body.resetPassword === true || body.resetPassword === "true";

    // Find existing admin for this institute
    let adminUser = await UserModal.findOne({
      where: { instituteId: institute.instituteId, roleId: adminRole.id, isDeleted: false },
    });

    const plainPassword = RegHelper.generateTempPassword();
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);

    let sendMailNeeded = false;

    if (adminUser) {
      // Check if email changed and is taken by another user
      if (adminEmail && adminEmail !== adminUser.emailId) {
        // Emails are compared case-insensitively (validation lower-cases the new one).
        const emailTaken = await UserModal.findOne({
          where: { [Op.and]: [sequelize.where(sequelize.fn("lower", sequelize.col("emailId")), adminEmail.toLowerCase()), { userId: { [Op.ne]: adminUser.userId } }] },
        });
        if (emailTaken) {
          return {
            error: true,
            statusCode: httpStatus.CONFLICT,
            message: "Email is already registered by another user.",
          };
        }
      }

      if (adminPhone && adminPhone !== adminUser.phoneNumber) {
        const phoneTaken = await UserModal.findOne({
          where: { phoneNumber: adminPhone, userId: { [Op.ne]: adminUser.userId } },
        });
        if (phoneTaken) {
          return {
            error: true,
            statusCode: httpStatus.CONFLICT,
            message: "Phone number is already registered by another user.",
          };
        }
      }

      // New email or explicit reset: issue (save + email) a new password, so the email always works.
      sendMailNeeded = resetPassword || Boolean(adminEmail && adminEmail !== adminUser.emailId);

      await adminUser.update({
        userName: `${adminFirstName ?? ""} ${adminLastName ?? ""}`.trim() || adminUser.userName,
        emailId: adminEmail ?? adminUser.emailId,
        phoneNumber: adminPhone ?? adminUser.phoneNumber,
        ...(sendMailNeeded ? { password: encryptedPassword } : {}),
      });
    } else {
      // Create new admin
      if (!adminEmail) {
        return {
          error: true,
          statusCode: httpStatus.BAD_REQUEST,
          message: "Admin email is required.",
        };
      }

      const emailTaken = await UserModal.findOne({
        where: sequelize.where(sequelize.fn("lower", sequelize.col("emailId")), String(adminEmail).toLowerCase()),
      });
      if (emailTaken) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "Email is already registered by another user.",
        };
      }

      if (!adminPhone || !adminPhone.trim()) {
        return {
          error: true,
          statusCode: httpStatus.BAD_REQUEST,
          message: "Admin phone number is required.",
        };
      }

      const phoneTaken = await UserModal.findOne({ where: { phoneNumber: adminPhone.trim() } });
      if (phoneTaken) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "Phone number is already registered by another user.",
        };
      }

      const adminUserId = newId("user");
      adminUser = await UserModal.create({
        userId: adminUserId,
        userName: `${adminFirstName ?? ""} ${adminLastName ?? ""}`.trim(),
        emailId: adminEmail.trim(),
        phoneNumber: adminPhone.trim(),
        password: encryptedPassword,
        roleId: adminRole.id,
        instituteId: institute.instituteId,
        status: 1,
      });

      sendMailNeeded = true;
    }

    const loginUrl = `${config.frontendUrl}/${institute.slug}/auth/signin`;

    if (sendMailNeeded) {
      try {
        await sendAdminCredentials({
          adminName: adminUser.userName,
          adminEmail: adminUser.emailId,
          adminPassword: plainPassword,
          instituteName: institute.instituteName,
          loginUrl,
          plan: institute.plan || "basic",
        });
      } catch (mailErr) {
        console.warn("Mail sending warning:", mailErr);
      }
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: sendMailNeeded ? "Admin saved and login details emailed." : "Admin details saved.",
      data: {
        admin: exclude(adminUser.toJSON(), ["password", "refreshToken"]),
      },
    };
  } catch (e: any) {
    console.error("Error in addInstituteAdmin:", e);

    if (e.name === "SequelizeUniqueConstraintError") {
      const field = e.errors?.[0]?.path;
      let message = "This record already exists.";
      if (field === "phoneNumber") message = "This phone number is already registered.";
      if (field === "emailId") message = "This email is already registered.";

      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message,
      };
    }

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  registerInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  softDeleteInstitute,
  toggleInstituteStatus,
  resendAdminCredentials,
  getInstituteBySlug,
  getInstituteCredentials,
  addInstituteAdmin,
};
