import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import Role from "../modals/Role.modal";
import Institute from "../modals/Institute.modal";
import EncryptPassword from "../utils/encryption";
import RegHelper from "../utils/helper";
import exclude from "../utils/exclude";
import { sequelize } from "../config/sequelize";
import { Op } from "sequelize";

// ─── CREATE TEACHER ───────────────────────────────────────────────────────────
const createTeacher = async (
  body: any,
  files: any,
  createdBy: any,
): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    // 1. Get instituteId from admin token
    const instituteId = createdBy.instituteId;
    if (!instituteId) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute not found for this admin.",
      };
    }

    // 2. Check institute active
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

    // 3. Check email unique
    const emailExists = await UserModal.findOne({
      where: { emailId: body.emailId },
    });
    if (emailExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Email is already registered.",
      };
    }

    // 4. Check phone unique
    const phoneExists = await UserModal.findOne({
      where: { phoneNumber: body.phoneNumber },
    });
    if (phoneExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Phone number is already registered.",
      };
    }

    // 5. Check employeeID unique within institute
    const empExists = await TeacherProfile.findOne({
      where: { employeeID: body.employeeID, instituteId },
    });
    if (empExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Employee ID already exists in this institute.",
      };
    }

    // 6. Find TEACHER role
    const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });
    if (!teacherRole) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "TEACHER role not found. Please seed roles.",
      };
    }

    // 7. Profile photo
    const profileUrl = files?.profilePhoto?.[0]
      ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
      : null;

    // 8. Create user record
    const plainPassword = body.password || (await RegHelper.generatePassword());
    const encryptedPassword = await EncryptPassword.encryptPassword(
      plainPassword,
    );
    const userId = await RegHelper.generateUserId();

    const newUser = await UserModal.create(
      {
        userId,
        userName: `${body.firstName} ${body.lastName}`,
        emailId: body.emailId,
        phoneNumber: body.phoneNumber,
        password: encryptedPassword,
        roleId: teacherRole.id,
        instituteId,
        status: 1,
      },
      { transaction: t },
    );

    // 9. Create teacher profile record
    await TeacherProfile.create(
      {
        userId: newUser.userId,
        instituteId,
        employeeID: body.employeeID,
        teacherType: body.teacherType,
        qualification: body.qualification,
        specialization: body.specialization || null,
        experience: body.experience || null,
        joiningDate: new Date(body.joiningDate),
        dob: new Date(body.dob),
        profileUrl,
        isExaminer: false,
        examinerSince: null,
      },
      { transaction: t },
    );

    // 10. Commit
    await t.commit();

    const userResponse = exclude(newUser.toJSON(), [
      "password",
      "refreshToken",
    ]);

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Teacher created successfully.",
      data: {
        user: userResponse,
        plainPassword, // ← send via email
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

// ─── GET ALL TEACHERS ─────────────────────────────────────────────────────────
const getAllTeachers = async (createdBy: any, query: any): Promise<any> => {
  try {
    const { search = "", isExaminer = "" } = query;
    const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });

    const where: any = {
      instituteId: createdBy.instituteId,
      roleId: teacherRole?.id,
      status: 1,
    };

    if (search) {
      where[Op.or] = [
        { userName: { [Op.iLike]: `%${search}%` } },
        { emailId: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const teachers = await UserModal.findAll({
      where,
      include: [
        { model: Role, as: "role" },
        { model: TeacherProfile, as: "teacherProfile", required: false },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
      order: [["userName", "ASC"]],
    });

    let result = teachers.map((u: any) => ({
      userId: u.userId,
      userName: u.userName,
      emailId: u.emailId,
      phoneNumber: u.phoneNumber,
      status: u.status,
      instituteId: u.instituteId,
      employeeID: u.teacherProfile?.employeeID ?? null,
      teacherType: u.teacherProfile?.teacherType ?? null,
      qualification: u.teacherProfile?.qualification ?? null,
      specialization: u.teacherProfile?.specialization ?? null,
      experience: u.teacherProfile?.experience ?? null,
      joiningDate: u.teacherProfile?.joiningDate ?? null,
      dob: u.teacherProfile?.dob ?? null,
      profileUrl: u.teacherProfile?.profileUrl ?? null,
      isExaminer: u.teacherProfile?.isExaminer ?? false,
      examinerSince: u.teacherProfile?.examinerSince ?? null,
    }));

    // Filter by examiner flag
    if (isExaminer === "true") result = result.filter((r) => r.isExaminer);
    if (isExaminer === "false") result = result.filter((r) => !r.isExaminer);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teachers fetched successfully.",
      data: {
        teachers: result,
        total: result.length,
        examinerCount: result.filter((r) => r.isExaminer).length,
        teacherCount: result.filter((r) => !r.isExaminer).length,
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

// ─── GET ONE TEACHER ──────────────────────────────────────────────────────────
const getTeacherById = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const teacher = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
      include: [
        { model: Role, as: "role" },
        { model: TeacherProfile, as: "teacherProfile" },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
    });

    if (!teacher) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Teacher not found.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher fetched successfully.",
      data: teacher,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE TEACHER ───────────────────────────────────────────────────────────
const updateTeacher = async (
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
        message: "Teacher not found.",
      };
    }

    const profile = await TeacherProfile.findOne({ where: { userId } });

    // Update user
    await user.update(
      {
        userName:
          body.firstName && body.lastName
            ? `${body.firstName} ${body.lastName}`
            : user.userName,
        phoneNumber: body.phoneNumber ?? user.phoneNumber,
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
          teacherType: body.teacherType ?? profile.teacherType,
          qualification: body.qualification ?? profile.qualification,
          specialization: body.specialization ?? profile.specialization,
          experience: body.experience ?? profile.experience,
          profileUrl,
        },
        { transaction: t },
      );
    }

    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher updated successfully.",
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

// ─── SOFT DELETE TEACHER ──────────────────────────────────────────────────────
const deleteTeacher = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Teacher not found.",
      };
    }

    await user.update({ status: 0 });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher deactivated successfully.",
      data: {},
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── ASSIGN EXAMINER ──────────────────────────────────────────────────────────
const assignExaminer = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const profile = await TeacherProfile.findOne({
      where: { userId, instituteId: createdBy.instituteId },
    });

    if (!profile) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Teacher profile not found.",
      };
    }

    if (profile.isExaminer) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Teacher is already an examiner.",
      };
    }

    await profile.update({
      isExaminer: true,
      examinerSince: new Date(),
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher assigned as examiner successfully.",
      data: { userId, isExaminer: true },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── REMOVE EXAMINER ──────────────────────────────────────────────────────────
const removeExaminer = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const profile = await TeacherProfile.findOne({
      where: { userId, instituteId: createdBy.instituteId },
    });

    if (!profile) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Teacher profile not found.",
      };
    }

    if (!profile.isExaminer) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Teacher is not an examiner.",
      };
    }

    await profile.update({
      isExaminer: false,
      examinerSince: null,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Examiner role removed successfully.",
      data: { userId, isExaminer: false },
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
  createTeacher,
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
  assignExaminer,
  removeExaminer,
};
