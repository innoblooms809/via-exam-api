import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import StudentProfile from "../modals/Student.modal";
import Role from "../modals/Role.modal";
import Institute from "../modals/Institute.modal";
import EncryptPassword from "../utils/encryption";
import RegHelper from "../utils/helper";
import exclude from "../utils/exclude";
import { sequelize } from "../config/sequelize";
import { Op } from "sequelize";

// ─── CREATE STUDENT ───────────────────────────────────────────────────────────
const createStudent = async (
  body: any,
  files: any,
  createdBy: any
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
      where: { emailId: body.email },
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
      where: { phoneNumber: body.mobile },
    });
    if (phoneExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Phone number is already registered.",
      };
    }

    // 4. Check roll number unique within class+division+year
    const rollExists = await StudentProfile.findOne({
      where: {
        instituteId,
        rollNumber:   body.rollNumber,
        className:    body.className,
        division:     body.division,
        academicYear: body.academicYear,
      },
    });
    if (rollExists) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: `Roll number ${body.rollNumber} already exists in ${body.className} ${body.division} for ${body.academicYear}.`,
      };
    }

    // 5. Find STUDENT role
    const studentRole = await Role.findOne({ where: { role: "STUDENT" } });
    if (!studentRole) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "STUDENT role not found. Please seed roles.",
      };
    }

    // 6. Profile photo
    const profileUrl = files?.profilePhoto?.[0]
      ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
      : null;

    // 7. Create user
    const plainPassword     = body.password || await RegHelper.generatePassword();
    const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
    const userId            = await RegHelper.generateUserId();

    const newUser = await UserModal.create(
      {
        userId,
        userName:    `${body.firstName} ${body.lastName}`,
        emailId:     body.email,
        phoneNumber: body.mobile,
        password:    encryptedPassword,
        roleId:      studentRole.id,
        instituteId,
        status: 1,
      },
      { transaction: t }
    );

    // 8. Create student profile
    await StudentProfile.create(
      {
        userId:       newUser.userId,
        instituteId,
        rollNumber:   body.rollNumber,
        className:    body.className,
        division:     body.division,
        academicYear: body.academicYear,
        fatherName:   body.fatherName,
        gender:       body.gender,
        dob:          new Date(body.dob),
        aadhar:       body.aadhar,
        address:      body.address,
        profileUrl,
        isActive:     true,
      },
      { transaction: t }
    );

    await t.commit();

    const userResponse = exclude(newUser.toJSON(), ["password", "refreshToken"]);

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Student created successfully.",
      data: {
        user:          userResponse,
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

// ─── GET ALL STUDENTS ─────────────────────────────────────────────────────────
const getAllStudents = async (
  createdBy: any,
  query: any
): Promise<any> => {
  try {
    const {
      search = "",
      className = "",
      division = "",
      academicYear = "",
    } = query;

    const studentRole = await Role.findOne({ where: { role: "STUDENT" } });

    const where: any = {
      instituteId: createdBy.instituteId,
      roleId:      studentRole?.id,
      status:      1,
    };

    if (search) {
      where[Op.or] = [
        { userName: { [Op.iLike]: `%${search}%` } },
        { emailId:  { [Op.iLike]: `%${search}%` } },
      ];
    }

    // Profile filters
    const profileWhere: any = {};
    if (className)    profileWhere.className    = className;
    if (division)     profileWhere.division     = division;
    if (academicYear) profileWhere.academicYear = academicYear;

    const students = await UserModal.findAll({
      where,
      include: [
        { model: Role,           as: "role" },
        {
          model:    StudentProfile,
          as:       "studentProfile",
          required: Object.keys(profileWhere).length > 0,
          where:    Object.keys(profileWhere).length > 0 ? profileWhere : undefined,
        },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
      order: [["userName", "ASC"]],
    });

    const result = students.map((u: any) => ({
      userId:       u.userId,
      userName:     u.userName,
      emailId:      u.emailId,
      phoneNumber:  u.phoneNumber,
      status:       u.status,
      instituteId:  u.instituteId,
      rollNumber:   u.studentProfile?.rollNumber   ?? null,
      className:    u.studentProfile?.className    ?? null,
      division:     u.studentProfile?.division     ?? null,
      academicYear: u.studentProfile?.academicYear ?? null,
      fatherName:   u.studentProfile?.fatherName   ?? null,
      gender:       u.studentProfile?.gender       ?? null,
      dob:          u.studentProfile?.dob          ?? null,
      aadhar:       u.studentProfile?.aadhar       ?? null,
      address:      u.studentProfile?.address      ?? null,
      profileUrl:   u.studentProfile?.profileUrl   ?? null,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Students fetched successfully.",
      data: { students: result, total: result.length },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ONE STUDENT ──────────────────────────────────────────────────────────
const getStudentById = async (
  userId: string,
  createdBy: any
): Promise<any> => {
  try {
    const student = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
      include: [
        { model: Role,           as: "role" },
        { model: StudentProfile, as: "studentProfile" },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
    });

    if (!student) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Student not found.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student fetched successfully.",
      data: student,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE STUDENT ───────────────────────────────────────────────────────────
const updateStudent = async (
  userId: string,
  body: any,
  files: any,
  createdBy: any
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
        message: "Student not found.",
      };
    }

    const profile = await StudentProfile.findOne({ where: { userId } });

    // Update user
    await user.update(
      {
        userName:    body.firstName && body.lastName
          ? `${body.firstName} ${body.lastName}`
          : user.userName,
        phoneNumber: body.mobile ?? user.phoneNumber,
      },
      { transaction: t }
    );

    // Update profile
    if (profile) {
      const profileUrl = files?.profilePhoto?.[0]
        ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
        : profile.profileUrl;

      await profile.update(
        {
          fatherName:   body.fatherName   ?? profile.fatherName,
          gender:       body.gender       ?? profile.gender,
          division:     body.division     ?? profile.division,
          className:    body.className    ?? profile.className,
          academicYear: body.academicYear ?? profile.academicYear,
          address:      body.address      ?? profile.address,
          profileUrl,
        },
        { transaction: t }
      );
    }

    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student updated successfully.",
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

// ─── DEACTIVATE STUDENT ───────────────────────────────────────────────────────
const deleteStudent = async (
  userId: string,
  createdBy: any
): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      where: { userId, instituteId: createdBy.instituteId },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Student not found.",
      };
    }

    await user.update({ status: 0 });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student deactivated successfully.",
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

// ─── BULK CREATE STUDENTS ─────────────────────────────────────────────────────
const bulkCreateStudents = async (
  students: any[],
  createdBy: any
): Promise<any> => {
  const t = await sequelize.transaction();
  try {
    const instituteId  = createdBy.instituteId;
    const studentRole  = await Role.findOne({ where: { role: "STUDENT" } });
    if (!studentRole) {
      await t.rollback();
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "STUDENT role not found.",
      };
    }

    let created  = 0;
    let skipped  = 0;
    const errors: string[] = [];

    for (const s of students) {
      try {
        // Check duplicates
        const emailExists = await UserModal.findOne({ where: { emailId: s.email } });
        const rollExists  = await StudentProfile.findOne({
          where: {
            instituteId,
            rollNumber:   s.rollNumber,
            className:    s.className,
            division:     s.division,
            academicYear: s.academicYear,
          },
        });

        if (emailExists || rollExists) {
          skipped++;
          continue;
        }

        const plainPassword     = await RegHelper.generatePassword();
        const encryptedPassword = await EncryptPassword.encryptPassword(plainPassword);
        const userId            = await RegHelper.generateUserId();

        const newUser = await UserModal.create(
          {
            userId,
            userName:    `${s.firstName} ${s.lastName}`,
            emailId:     s.email,
            phoneNumber: s.mobile,
            password:    encryptedPassword,
            roleId:      studentRole.id,
            instituteId,
            status: 1,
          },
          { transaction: t }
        );

        await StudentProfile.create(
          {
            userId:       newUser.userId,
            instituteId,
            rollNumber:   s.rollNumber,
            className:    s.className,
            division:     s.division,
            academicYear: s.academicYear,
            fatherName:   s.fatherName   || "Not provided",
            gender:       s.gender       || "other",
            dob:          new Date(s.dob || "2000-01-01"),
            aadhar:       s.aadhar       || "000000000000",
            address:      s.address      || "Not provided",
          },
          { transaction: t }
        );

        created++;
      } catch (err) {
        errors.push(`Row ${created + skipped + 1}: Failed`);
        skipped++;
      }
    }

    await t.commit();

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: `Bulk upload complete.`,
      data: { created, skipped, errors },
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

export default {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  bulkCreateStudents,
};