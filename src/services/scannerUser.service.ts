import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import ScannerProfile from "../modals/ScannerProfile.modal";
import Role from "../modals/Role.modal";
import Institute from "../modals/Institute.modal";
import EncryptPassword from "../utils/encryption";
import RegHelper from "../utils/helper";
import { sequelize } from "../config/sequelize";
import { Op } from "sequelize";

// ─── CREATE SCANNER ───────────────────────────────────────────────────────────
const createScanner = async (
  body: any,
  files: any,
  createdBy: any,
): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const instituteId = createdBy.instituteId;
    if (!instituteId) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute not found for this admin.",
      };
    }

    // 1. Check institute active
    const institute = await Institute.findOne({
      where: { instituteId, isDeleted: false, status: 1 },
    });
    if (!institute) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Institute not found or inactive.",
      };
    }

    // 2. Check email unique
    const emailExists = await UserModal.findOne({
      where: { emailId: body.emailId || body.email },
    });
    if (emailExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Email is already registered.",
      };
    }

    // 3. Check phone unique
    const phoneExists = await UserModal.findOne({
      where: { phoneNumber: body.phoneNumber || body.mobile },
    });
    if (phoneExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Phone number is already registered.",
      };
    }

    // 4. Find SCANNER role
    const scannerRole = await Role.findOne({ where: { role: "SCANNER" } });
    if (!scannerRole) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "SCANNER role not found. Please seed roles.",
      };
    }

    // 5. Profile photo
    const profileUrl = files?.profilePhoto?.[0]
      ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
      : null;

    // 6. Create user record
    const plainPassword = body.password || (await RegHelper.generatePassword());
    const encryptedPassword = await EncryptPassword.encryptPassword(
      plainPassword,
    );
    const userId = await RegHelper.generateUserId();

    const newUser = await UserModal.create(
      {
        userId,
        userName: `${body.firstName} ${body.lastName}`,
        emailId: body.emailId || body.email,
        phoneNumber: body.phoneNumber || body.mobile,
        password: encryptedPassword,
        roleId: scannerRole.id,
        instituteId,
        status: 1,
      },
      { transaction: t },
    );

    // 7. Create scanner profile record
    await ScannerProfile.create(
      {
        userId: newUser.userId,
        instituteId,
        address: body.address || null,
        dob: body.dob ? new Date(body.dob) : null,
        gender: body.gender || null,
        aadhar: body.aadhar || null,
        profileUrl,
      },
      { transaction: t },
    );

    // 8. Commit
    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Scanner created successfully.",
      data: {
        userId: newUser.userId,
        plainPassword,
        instituteName: institute.instituteName,
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

// ─── GET ALL SCANNERS ─────────────────────────────────────────────────────────
const getAllScanners = async (createdBy: any, query: any): Promise<any> => {
  try {
    const { search = "", status } = query;
    const scannerRole = await Role.findOne({ where: { role: "SCANNER" } });

    const where: any = {
      instituteId: createdBy.instituteId,
      roleId: scannerRole?.id,
    };

    // Only add status filter if explicitly provided
    if (status !== undefined && status !== "") {
      where.status = parseInt(status, 10);
    }

    if (search) {
      where[Op.or] = [
        { userName: { [Op.iLike]: `%${search}%` } },
        { emailId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const scanners = await UserModal.findAll({
      where,
      include: [
        { model: Role, as: "role" },
        { model: ScannerProfile, as: "scannerProfile", required: false },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
      order: [["userName", "ASC"]],
    });

    const result = scanners.map((u: any) => {
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
        address: u.scannerProfile?.address ?? null,
        dob: u.scannerProfile?.dob ?? null,
        gender: u.scannerProfile?.gender ?? null,
        aadhar: u.scannerProfile?.aadhar ?? null,
        profileUrl: u.scannerProfile?.profileUrl ?? null,
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scanners fetched successfully.",
      data: {
        scanners: result,
        total: result.length,
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

// ─── GET ONE SCANNER ──────────────────────────────────────────────────────────
const getScannerById = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const scanner = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
      include: [
        { model: Role, as: "role" },
        { model: ScannerProfile, as: "scannerProfile" },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
    });

    if (!scanner) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Scanner not found.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scanner fetched successfully.",
      data: scanner,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE SCANNER ───────────────────────────────────────────────────────────
const updateScanner = async (
  userId: string,
  body: any,
  files: any,
  createdBy: any,
): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const user = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
    });

    if (!user) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Scanner not found.",
      };
    }

    const profile = await ScannerProfile.findOne({ where: { userId } });

    // Update user
    await user.update(
      {
        userName:
          body.firstName && body.lastName
            ? `${body.firstName} ${body.lastName}`
            : user.userName,
        phoneNumber: body.phoneNumber ?? user.phoneNumber,
        status: body.status !== undefined ? parseInt(body.status, 10) : user.status,
      },
      { transaction: t },
    );

    // Update profile
    if (profile) {
      const profileUrl = files?.profilePhoto?.[0]
        ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
        : profile.profileUrl;

      await profile.update(
        {
          address: body.address ?? profile.address,
          dob: body.dob ? new Date(body.dob) : profile.dob,
          gender: body.gender ?? profile.gender,
          aadhar: body.aadhar ?? profile.aadhar,
          profileUrl,
        },
        { transaction: t },
      );
    }

    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scanner updated successfully.",
      data: { userId, userName: user.userName },
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

// ─── SOFT DELETE SCANNER ──────────────────────────────────────────────────────
const deleteScanner = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Scanner not found.",
      };
    }

    console.log("Before deactivation - Scanner status:", user.status);
    await user.update({ status: 0 });
    console.log("After deactivation - Scanner status:", user.status);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scanner deactivated successfully.",
      data: {},
    };
  } catch (e: any) {
    console.error("Delete scanner error:", e);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── REACTIVATE SCANNER ──────────────────────────────────────────────────────
const reactivateScanner = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Scanner not found.",
      };
    }

    console.log("Before reactivation - Scanner status:", user.status);
    await user.update({ status: 1 });
    console.log("After reactivation - Scanner status:", user.status);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scanner reactivated successfully.",
      data: {},
    };
  } catch (e: any) {
    console.error("Reactivate scanner error:", e);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  createScanner,
  getAllScanners,
  getScannerById,
  updateScanner,
  deleteScanner,
  reactivateScanner,
};
