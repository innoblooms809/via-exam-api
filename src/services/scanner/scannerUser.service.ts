import httpStatus from "http-status";
import UserModal from "../../models/User.model";
import ScannerProfile from "../../models/ScannerProfile.model";
import Role from "../../models/Role.model";
import Institute from "../../models/Institute.model";
import EncryptPassword from "../../utils/encryption";
import RegHelper from "../../utils/helper";
import { sequelize } from "../../config/sequelize";
import { Op } from "sequelize";
import { findStaff, scannerOpenWork } from "../academic/academicGuards.service";
import { newId } from "../../utils/idGenerator";
import { cleanEmail, contactTakenMessage, staffInputProblem } from "../../utils/staffInput";
import ExamScannerAssignment from "../../models/ExamScannerAssignment.model";

// ─── CREATE SCANNER ───────────────────────────────────────────────────────────
// Checks run before the transaction opens, so they never wait on its connection.
const createScanner = async (
  body: any,
  files: any,
  createdBy: any,
): Promise<any> => {
  const instituteId = createdBy.instituteId;
  if (!instituteId) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for this admin." };
  const problem = staffInputProblem(body, { requireDob: false });
  if (problem) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: problem };
  const email = cleanEmail(body.emailId ?? body.email);
  const phone = String(body.phoneNumber ?? body.mobile).trim();

  const institute = await Institute.findOne({ where: { instituteId, isDeleted: false, status: 1 } });
  if (!institute) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Institute not found or inactive." };
  const taken = await contactTakenMessage(email, phone, instituteId);
  if (taken) return { error: true, statusCode: httpStatus.CONFLICT, message: taken };
  const scannerRole = await Role.findOne({ where: { role: "SCANNER" } });
  if (!scannerRole) return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "SCANNER role not found. Please seed roles." };

  try {
    const profileUrl = files?.profilePhoto?.[0] ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}` : null;
    const plainPassword = body.password || (await RegHelper.generatePassword());
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
    const userId = newId("user");

    await sequelize.transaction(async (t) => {
      await UserModal.create(
        {
          userId,
          userName: `${String(body.firstName).trim()} ${String(body.lastName).trim()}`,
          emailId: email,
          phoneNumber: phone,
          password: encryptedPassword,
          roleId: scannerRole.id,
          instituteId,
          status: 1,
        },
        { transaction: t },
      );
      await ScannerProfile.create(
        {
          userId,
          instituteId,
          address: body.address || null,
          dob: body.dob ? new Date(body.dob) : null,
          gender: body.gender || null,
          aadhar: body.aadhar || null,
          profileUrl,
        },
        { transaction: t },
      );
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Scanner staff added.",
      data: { userId, email, plainPassword, instituteName: institute.instituteName, instituteSlug: institute.slug },
    };
  } catch (e: any) {
    console.error(e);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
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

    const ids = scanners.map((u: any) => u.userId);
    const assignments = ids.length
      ? ((await ExamScannerAssignment.findAll({
          where: { instituteId: createdBy.instituteId, scannerId: { [Op.in]: ids }, isActive: true },
          attributes: ["scannerId", "status"],
          raw: true,
        })) as any[])
      : [];

    const result = scanners.map((u: any) => {
      const mine = assignments.filter((a) => a.scannerId === u.userId);
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
        examsAssigned: mine.length,
        examsOpen: mine.filter((a) => a.status === "ASSIGNED").length,
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
// Details only. Deactivating goes through deleteScanner, which checks open work.
const updateScanner = async (
  userId: string,
  body: any,
  files: any,
  createdBy: any,
): Promise<any> => {
  const instituteId = createdBy.instituteId;
  const user = await findStaff(userId, instituteId, "SCANNER");
  if (!user) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Scanner not found." };
  const profile = await ScannerProfile.findOne({ where: { userId } });

  const first = String(body.firstName ?? "").trim();
  const last = String(body.lastName ?? "").trim();
  const nameRule = /^[A-Za-z][A-Za-z.'’ -]{0,49}$/;
  if ((first || last) && (!nameRule.test(first) || !nameRule.test(last))) {
    return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "First and last name can only have letters, spaces, dots, apostrophes and hyphens." };
  }
  const phone = body.phoneNumber !== undefined ? String(body.phoneNumber).trim() : undefined;
  if (phone !== undefined && phone !== user.phoneNumber) {
    if (!/^[6-9]\d{9}$/.test(phone)) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Enter a 10-digit mobile number starting with 6, 7, 8 or 9." };
    const taken = await contactTakenMessage("", phone, instituteId, userId);
    if (taken) return { error: true, statusCode: httpStatus.CONFLICT, message: taken };
  }
  const dob = body.dob ? new Date(body.dob) : null;
  if (dob && Number.isNaN(dob.getTime())) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Enter a valid date of birth." };

  try {
    await sequelize.transaction(async (t) => {
      await user.update({ userName: first && last ? `${first} ${last}` : user.userName, phoneNumber: phone ?? user.phoneNumber }, { transaction: t });
      if (profile) {
        const profileUrl = files?.profilePhoto?.[0] ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}` : profile.profileUrl;
        await profile.update(
          {
            address: body.address ?? profile.address,
            dob: dob ?? profile.dob,
            gender: body.gender ?? profile.gender,
            aadhar: body.aadhar ?? profile.aadhar,
            profileUrl,
          },
          { transaction: t },
        );
      }
    });
    return { error: false, statusCode: httpStatus.OK, message: "Scanner staff saved.", data: { userId, userName: user.userName } };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

// ─── SOFT DELETE SCANNER ──────────────────────────────────────────────────────
// Refused while the scanner still has exams to upload.
const deleteScanner = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const user = await findStaff(userId, instituteId, "SCANNER");
    if (!user) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Scanner not found." };

    const work = await scannerOpenWork(userId, instituteId);
    if (work.total) return { error: true, statusCode: httpStatus.CONFLICT, message: work.message };

    await user.update({ status: 0, refreshToken: null });
    return { error: false, statusCode: httpStatus.OK, message: `${user.userName} deactivated.`, data: {} };
  } catch (e: any) {
    console.error("Delete scanner error:", e);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

// ─── REACTIVATE SCANNER ──────────────────────────────────────────────────────
const reactivateScanner = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const user = await findStaff(userId, createdBy.instituteId, "SCANNER");
    if (!user) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Scanner not found." };
    await user.update({ status: 1 });
    return { error: false, statusCode: httpStatus.OK, message: `${user.userName} reactivated.`, data: {} };
  } catch (e: any) {
    console.error("Reactivate scanner error:", e);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
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
