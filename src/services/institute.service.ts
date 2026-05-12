import httpStatus from "http-status";
import Institute from "../modals/Institute.modal";
import UserModal from "../modals/User.modal";
import Role from "../modals/Role.modal";
import EncryptPassword from "../utils/encryption";
import RegHelper from "../utils/helper";
import exclude from "../utils/exclude";
import { sequelize } from "../config/sequelize";
import { Op } from "sequelize";
import { sendAdminCredentials } from "../utils/mailHelper";

const registerInstitute = async (body: any, files: any): Promise<any> => {
  // Use a transaction — if admin user creation fails, institute also rolls back
  const t = await sequelize.transaction();

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

    // 2. Check admin email uniqueness
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

    // 3. Check admin phone uniqueness
    const phoneExists = await UserModal.findOne({
      where: { phoneNumber: body.adminPhone },
    });
    if (phoneExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Admin phone number is already registered.",
      };
    }

    // 4. Get file paths from multer
    const logoUrl = files?.logo?.[0]
      ? `/${files.logo[0].path.replace(/\\/g, "/")}`
      : null;
    const bannerUrl = files?.banner?.[0]
      ? `/${files.banner[0].path.replace(/\\/g, "/")}`
      : null;

    // 5. Calculate trial end date
    const trialDays = parseInt(body.trialDays) || 0;
    const trialEndsAt =
      trialDays > 0
        ? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000)
        : null;

    // 6. Generate institute ID
    const instituteId = await RegHelper.generateUserId(); // reuse your ID generator

    // 7. Create Institute record
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
        status: 1,
      },
      { transaction: t },
    );

    // 8. Find admin role
    const adminRole = await Role.findOne({ where: { role: "ADMIN" } });
    if (!adminRole) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "Admin role not found. Please seed roles first.",
      };
    }

    // 9. Create Admin user tied to this institute
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
        instituteId: institute.instituteId, // link admin → institute
        status: 1,
      },
      { transaction: t },
    );

    // 10. All good — commit
    await t.commit();

    const adminResponse = exclude(adminUser.toJSON(), [
      "password",
      "refreshToken",
    ]);

    // 11. Send credentials email to admin
    // const loginUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3040"}/${
    //   body.slug
    // }/auth/signin`;

    const loginUrl = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/${
  body.slug
}/auth/signin`;

    await sendAdminCredentials({
      adminName: `${body.adminFirstName} ${body.adminLastName}`,
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword, // ← plain password before encryption
      instituteName: body.instituteName,
      loginUrl,
      plan: body.plan,
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Institute registered successfully.",
      data: {
        institute,
        admin: adminResponse,
        // loginUrl: `${process.env.FRONTEND_URL}/${body.slug}/auth/signin`,
        loginUrl: `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/${
          body.slug
        }/auth/signin`,
        logoUrl,
      },
    };
  } catch (e: any) {
    await t.rollback();
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

    return {
      error: false,
      statusCode: httpStatus.OK,
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
    console.log("🔍 Looking for:", identifier);

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

    console.log("📦 Found:", institute ? institute.instituteId : "NULL");

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
    const institute = await Institute.findOne({
      where: { instituteId, isDeleted: false },
    });

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
          instituteId: { [Op.ne]: instituteId }, // exclude current institute
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
    const logoUrl = files?.logo?.[0]
      ? `/${files.logo[0].path.replace(/\\/g, "/")}`
      : institute.logoUrl;

    const bannerUrl = files?.banner?.[0]
      ? `/${files.banner[0].path.replace(/\\/g, "/")}`
      : institute.bannerUrl;

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
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Institute updated successfully.",
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

// ─── SOFT DELETE ──────────────────────────────────────────────────────────────
// Sets isDeleted = true instead of removing from DB
// Also deactivates the linked admin user

const softDeleteInstitute = async (instituteId: string): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const institute = await Institute.findOne({
      where: { instituteId, isDeleted: false },
    });

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
      { where: { instituteId }, transaction: t },
    );

    await t.commit();

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
    const institute = await Institute.findOne({
      where: { instituteId, isDeleted: false },
    });

    if (!institute) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found.",
      };
    }

    await institute.update({ status });

    // Also update all users of this institute
    await UserModal.update({ status }, { where: { instituteId } });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Institute ${
        status === 1 ? "activated" : "deactivated"
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

export default {
  registerInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  softDeleteInstitute,
  toggleInstituteStatus,
};
