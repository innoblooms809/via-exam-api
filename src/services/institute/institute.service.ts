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


// ------------CREATE INSTITUTE + ADMIN USER IN ONE TRANSACTION----------------
const registerInstitute = async (body: any, files: any): Promise<any> => {
  // Use a transaction — if admin user creation fails, institute also rolls back
  const t = await sequelize.transaction();

  // Declared outside the try so the catch block can clean up an uploaded
  // logo/banner if a later step (e.g. admin creation) fails.
  let logoUrl: string | null = null;
  let logoPublicId: string | null = null;
  let bannerUrl: string | null = null;
  let bannerPublicId: string | null = null;

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
    const instituteId = await RegHelper.generateUserId();

    // 6. Upload logo/banner to Cloudinary, if provided
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
      if (files?.banner?.[0]) {
        const stored = await uploadInstituteAsset({
          buffer: files.banner[0].buffer,
          instituteId,
          kind: "banner",
        });
        bannerUrl = stored.url;
        bannerPublicId = stored.publicId;
      }
    } catch (uploadErr: any) {
      await t.rollback();
      if (logoPublicId) await destroyInstituteAsset(logoPublicId, "register rollback");
      if (bannerPublicId) await destroyInstituteAsset(bannerPublicId, "register rollback");
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: `Could not store logo/banner: ${uploadErr?.message ?? uploadErr}`,
      };
    }

    // 7. Calculate trial end date
    const trialDays = parseInt(body.trialDays) || 0;
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
        bannerUrl,
        logoPublicId,
        bannerPublicId,
        status: 1,
      },
      { transaction: t },
    );

    let adminResponse = null;
    const loginUrl = `${config.frontendUrl}/${body.slug}/auth/signin`;

    // 9. Create Admin user ONLY if admin fields are provided
    if (hasAdminData) {
      const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
      if (!adminRole) {
        await t.rollback();
        if (logoPublicId) await destroyInstituteAsset(logoPublicId, "register rollback");
        if (bannerPublicId) await destroyInstituteAsset(bannerPublicId, "register rollback");
        return {
          error: true,
          statusCode: httpStatus.INTERNAL_SERVER_ERROR,
          message: "Admin role not found. Please seed roles first.",
        };
      }

      const encryptedPassword = await EncryptPassword.encryptPassword(
        body.adminPassword,
      );
      const adminUserId = await RegHelper.generateUserId();

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
    if (bannerPublicId) await destroyInstituteAsset(bannerPublicId, "register rollback");

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
const resendAdminCredentials = async (instituteId: string, password: string): Promise<any> => {
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

    // 3. Use the provided password
    const newPassword = password || RegHelper.generateTempPassword();
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
    const { page = 1, limit = 10, search = "", plan = "", status = "" } = query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause dynamically
    const where: any = {
      isDeleted: false, // soft delete filter
    };

    if (search) {
      where[Op.or] = [
        { instituteName: { [Op.iLike]: `%${search}%` } }, // iLike = case insensitive (postgres)
        { slug: { [Op.iLike]: `%${search}%` } },
        { city: { [Op.iLike]: `%${search}%` } },
        { contactEmail: { [Op.iLike]: `%${search}%` } },
      ];
    }

    if (plan) where.plan = plan;
    if (status) where.status = parseInt(status);

    const { count, rows } = await Institute.findAndCountAll({
      where,
      order: [["createdAt", "DESC"]],
      limit: parseInt(limit),
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
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(count / parseInt(limit)),
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
// Update institute details + optionally update logo/banner
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
    let bannerUrl = institute.bannerUrl;
    let bannerPublicId = institute.bannerPublicId;

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
      if (files?.banner?.[0]) {
        const stored = await uploadInstituteAsset({
          buffer: files.banner[0].buffer,
          instituteId: institute.instituteId,
          kind: "banner",
        });
        bannerUrl = stored.url;
        bannerPublicId = stored.publicId;
      }
    } catch (uploadErr: any) {
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: `Could not store logo/banner: ${uploadErr?.message ?? uploadErr}`,
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
      bannerUrl,
      logoPublicId,
      bannerPublicId,
    });

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
// Sets isDeleted = true instead of removing from DB
// Also deactivates the linked admin user

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
    const institute = await Institute.findOne({ where: whereCondition });

    if (!institute) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    // Soft delete institute
    await institute.update({ isDeleted: true, status: 0 }, { transaction: t });

    // Also deactivate all users of this institute
    await UserModal.update(
      { status: 0 },
      { where: { instituteId: institute.instituteId }, transaction: t },
    );

    await t.commit();

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

    await institute.update({ status });

    // Also update all users of this institute
    await UserModal.update({ status }, { where: { instituteId: institute.instituteId } });

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
      attributes: ["instituteName", "logoUrl", "bannerUrl", "slug", "status", "city"],
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

    const { adminFirstName, adminLastName, adminEmail, adminPhone, adminPassword } = body;

    // Find existing admin for this institute
    let adminUser = await UserModal.findOne({
      where: { instituteId: institute.instituteId, roleId: adminRole.id, isDeleted: false },
    });

    const plainPassword = adminPassword || RegHelper.generateTempPassword();
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);

    let sendMailNeeded = false;

    if (adminUser) {
      // Check if email changed and is taken by another user
      if (adminEmail && adminEmail !== adminUser.emailId) {
        const emailTaken = await UserModal.findOne({
          where: { emailId: adminEmail, userId: { [Op.ne]: adminUser.userId } },
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

      // If password or email changed, send email
      if (adminPassword || (adminEmail && adminEmail !== adminUser.emailId)) {
        sendMailNeeded = true;
      }

      await adminUser.update({
        userName: `${adminFirstName ?? ""} ${adminLastName ?? ""}`.trim() || adminUser.userName,
        emailId: adminEmail ?? adminUser.emailId,
        phoneNumber: adminPhone ?? adminUser.phoneNumber,
        ...(adminPassword ? { password: encryptedPassword } : {}),
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

      const emailTaken = await UserModal.findOne({ where: { emailId: adminEmail } });
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

      const adminUserId = await RegHelper.generateUserId();
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
      message: "Admin created/updated successfully and credentials emailed.",
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
