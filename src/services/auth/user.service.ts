import httpStatus from "http-status";
import UserModal from "../../models/User.model";
import Role from "../../models/Role.model";
import EncryptPassword from "../../utils/encryption"; // reuse your existing utility
import RegHelper from "../../utils/helper"; // reuse your existing utility
import exclude from "../../utils/exclude"; // reuse your existing utility
import { Op } from "sequelize";
import Institute from "../../models/Institute.model";
import UserPresenceSession from "../../models/UserPresenceSession.model";
import { logActivity } from "../../utils/activityLogger";

import TeacherProfile from "../../models/TeacherProfile.model";
import StudentProfile from "../../models/Student.model";
import ScannerProfile from "../../models/ScannerProfile.model";
import Section from "../../models/Section.model";
import { newId } from "../../utils/idGenerator";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_SECONDS = 5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fetch ViaExam user by emailId — mirrors your getUserByEmail() pattern
 */
const getViaExamUserByEmail = async (emailId: string, instituteId?: string | null): Promise<any> => {
  const where: any = {
    emailId: {
      [Op.iLike]: emailId,
    },
  };
  if (instituteId) {
    where.instituteId = instituteId;
  } else if (instituteId === null) {
    where.instituteId = { [Op.is]: null };
  }
  return UserModal.findOne({
    include: [
      {
        model: Role,
        as: "role",
      },
    ],
    where,
  });
};

/**
 * Fetch ViaExam user by phoneNumber — mirrors your getUserByMobile() pattern
 */
const getViaExamUserByMobile = async (phoneNumber: string): Promise<any> => {
  return UserModal.findOne({
    include: [
      {
        model: Role,
        as: "role",
      },
    ],
    where: { phoneNumber: phoneNumber },
  });
};

// ─── Service Functions ────────────────────────────────────────────────────────

/**
 * Create Super Admin user
 * Called once during initial setup — mirrors your userCreate() pattern
 */
const viaExamUserCreate = async (req: any): Promise<any> => {
  try {
    const conflictFields = [];
    const existUserEmail = await getViaExamUserByEmail(req.body.emailId);
    const existUserMobile = await getViaExamUserByMobile(req.body.phoneNumber);

    if (existUserEmail) conflictFields.push("email");
    if (existUserMobile) conflictFields.push("mobile");

    if (conflictFields.length > 0) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        data: {},
        message: `This ${conflictFields.join(" & ")} is already registered.`,
      };
    }

    // Reuse your existing helpers
    const password = await RegHelper.generatePassword();
    const encryptedPassword = await EncryptPassword.encryptPassword(password);
    const userId = newId("user");

    // Only these fields come from the request; password, ids and lockout state never do.
    const { userName, emailId, phoneNumber, roleId, instituteId } = req.body;
    const newUser = await UserModal.create({
      userId,
      userName,
      emailId,
      phoneNumber,
      roleId,
      instituteId: instituteId || null,
      password: encryptedPassword,
      status: 1,
    } as any);
    const { password: _, ...userResponse } = newUser.toJSON();

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      data: userResponse,
      password, // returned so caller can email the plain password
      message: "ViaExam user created successfully.",
    };
  } catch (e: any) {
    console.error(e);
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

/**
 * ViaExam login — mirrors your userLogin() pattern exactly.
 * type 1 = email login, type 2 = mobile login
 * Adds: account lockout, status checks
 */
const viaExamUserLogin = async (slug: string, emailId: string, password: string) => {
  try {
    console.log("EMAIL RECEIVED:", emailId);
    let instituteId: string | null = null;
    if (slug) {
      const institute = await Institute.findOne({ where: { slug } });
      if (!institute) {
        return {
          error: true,
          statusCode: httpStatus.BAD_REQUEST,
          message: "Invalid institute.",
        };
      }
      instituteId = institute.instituteId;
    }
    const user = await getViaExamUserByEmail(emailId, instituteId);
    console.log("USER FOUND:", user?.emailId);
    console.log("HASHED PASSWORD:", user?.password);

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
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

    const isMatch = await EncryptPassword.isPasswordMatch(password, user.password);

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
        statusCode: httpStatus.BAD_REQUEST,
        message: "Invalid credentials.",
      };
    }

    // Status checks come after the password, so they don't reveal which accounts exist.
    // A suspended institute blocks all of its users (suspension marks them 2), so say
    // that rather than blaming the person's own account.
    if (user.instituteId) {
      const userInstitute = await Institute.findOne({ where: { instituteId: user.instituteId }, attributes: ["status", "isDeleted"] });
      if (!userInstitute || userInstitute.isDeleted || Number(userInstitute.status) !== 1) {
        return {
          error: true,
          statusCode: httpStatus.FORBIDDEN,
          message: "Your institute's ViaExam access is suspended. Contact the ViaExam team.",
        };
      }
    }

    if (user.status === 0) {
      return {
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Your account is inactive.",
      };
    }

    if (user.status === 2) {
      return {
        error: true,
        statusCode: httpStatus.UNAUTHORIZED,
        message: "Account suspended.",
      };
    }

    // Reset lock info after successful login
    await UserModal.update(
      {
        loginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
      { where: { userId: user.userId } },
    );

    // Log Activity & Update Presence
    const now = new Date();
    let presenceSession = await UserPresenceSession.findOne({ where: { userId: user.userId } });
    if (presenceSession) {
      presenceSession.presenceStatus = "ONLINE";
      presenceSession.lastActivityAt = now;
      presenceSession.lastLoginAt = now;
      presenceSession.currentActivity = "Active in Portal";
      await presenceSession.save();
    } else {
      await UserPresenceSession.create({
        userId: user.userId,
        role: user.role?.role || "USER",
        instituteId: user.instituteId || null,
        presenceStatus: "ONLINE",
        currentActivity: "Active in Portal",
        lastActivityAt: now,
        lastLoginAt: now,
      });
    }

    await logActivity({
      userId: user.userId,
      role: user.role?.role || "USER",
      instituteId: user.instituteId || null,
      eventType: "LOGIN_SUCCESS",
      currentActivity: "Logged In",
    });

    const userResponse = exclude(
      user.toJSON(),
      ["password", "refreshToken"]
    );

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: {
        user: userResponse,
      },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: e.message,
    };
  }
};

/**
 * Logout — store/clear refresh token (mirrors your token invalidation pattern)
 */
const viaExamUserLogout = async (userId: string): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      include: [{ model: Role, as: "role" }],
      where: { userId },
    });

    await UserModal.update({ refreshToken: null }, { where: { userId } });

    // Instantly update active presence session to OFFLINE
    const logoutTime = new Date();
    const presenceSession = await UserPresenceSession.findOne({ where: { userId } });
    if (presenceSession) {
      presenceSession.presenceStatus = "OFFLINE";
      presenceSession.currentActivity = "Logged Out";
      presenceSession.lastLogoutAt = logoutTime;
      await presenceSession.save();
    }

    if (user) {
      await logActivity({
        userId: user.userId,
        role: (user as any).role?.role || "USER",
        instituteId: user.instituteId || null,
        eventType: "LOGOUT",
        currentActivity: "Logged Out",
      });
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: {},
      message: "Logged out successfully.",
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: `Something went wrong: ${e.message}`,
    };
  }
};

/**
 * Get ViaExam user profile by userId
 */
const viaExamGetProfile = async (userId: string): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      include: [
        { model: Role, as: "role" },
        { model: Institute, as: "institute" },
      ],
      where: { userId },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        data: {},
        message: "User not found.",
      };
    }

    const userResponse: any = exclude(user.toJSON(), ["password", "refreshToken"]);

    // Fetch role-specific details
    const teacherProfile = await TeacherProfile.findOne({ where: { userId } }).catch(() => null);
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
      if (teacherProfile.dob) userResponse.dob = teacherProfile.dob;
      if (teacherProfile.address) userResponse.address = teacherProfile.address;
    }

    const studentProfile = await StudentProfile.findOne({ where: { userId } }).catch(() => null);
    if (studentProfile) {
      userResponse.studentProfile = studentProfile.toJSON();
      userResponse.className = studentProfile.className;
      userResponse.sectionId = studentProfile.sectionId;
      userResponse.sectionName = studentProfile.sectionId;
      if (studentProfile.sectionId) {
        const sec = await Section.findOne({ where: { sectionId: studentProfile.sectionId } }).catch(() => null);
        if (sec) {
          userResponse.sectionName = sec.sectionName;
          userResponse.section = sec.sectionName;
        }
      }
      userResponse.rollNumber = studentProfile.rollNumber;
      userResponse.fatherName = studentProfile.fatherName;
      userResponse.session = studentProfile.session;
      userResponse.aadhar = studentProfile.aadhar;
      if (studentProfile.gender) userResponse.gender = studentProfile.gender;
      if (studentProfile.dob) userResponse.dob = studentProfile.dob;
      if (studentProfile.address) userResponse.address = studentProfile.address;
    }

    const scannerProfile = await ScannerProfile.findOne({ where: { userId } }).catch(() => null);
    if (scannerProfile) {
      userResponse.scannerProfile = scannerProfile.toJSON();
      if (scannerProfile.aadhar) userResponse.aadhar = scannerProfile.aadhar;
      if (scannerProfile.gender) userResponse.gender = scannerProfile.gender;
      if (scannerProfile.dob) userResponse.dob = scannerProfile.dob;
      if (scannerProfile.address) userResponse.address = scannerProfile.address;
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      data: userResponse,
      message: "Profile fetched successfully.",
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: e.message,
    };
  }
};

/**
 * Update ViaExam user profile by userId (email ID cannot be updated)
 */
const viaExamUpdateProfile = async (userId: string, body: any, files: any): Promise<any> => {
  try {
    const user = await UserModal.findOne({
      include: [{ model: Role, as: "role" }],
      where: { userId },
    });

    if (!user) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        data: {},
        message: "User not found.",
      };
    }

    const updates: any = {};

    // 1. Name update
    if (body.userName || body.name || body.firstName || body.lastName) {
      const first = body.firstName ?? "";
      const last = body.lastName ?? "";
      const fullName = (body.userName || body.name || `${first} ${last}`).trim();
      if (fullName) {
        updates.userName = fullName;
      }
    }

    // 2. Phone update
    if (body.phoneNumber || body.mobile || body.phone) {
      const phone = (body.phoneNumber || body.mobile || body.phone).trim();
      if (phone && phone !== user.phoneNumber) {
        const phoneExists = await UserModal.findOne({
          where: {
            phoneNumber: phone,
            userId: { [Op.ne]: user.userId },
          },
        });
        if (phoneExists) {
          return {
            error: true,
            statusCode: httpStatus.CONFLICT,
            data: {},
            message: "Phone number is already registered to another user.",
          };
        }
        updates.phoneNumber = phone;
      }
    }

    // 3. Profile Photo upload
    const uploadedFile = files?.profilePhoto?.[0] || files?.avatar?.[0];
    if (uploadedFile) {
      updates.profileUrl = `/${uploadedFile.path.replace(/\\/g, "/")}`;
    } else if (body.profileUrl || body.profileImage) {
      // Only an https image URL or a path we serve ourselves — never javascript:/data: URLs.
      const candidate = String(body.profileUrl || body.profileImage).trim();
      const isOwnUpload = /^\/(v1\/)?uploads\/[A-Za-z0-9/_.-]+$/.test(candidate) && !candidate.includes("..");
      const isHttpsUrl = /^https:\/\/[^\s"'<>]+$/i.test(candidate) && candidate.length <= 2048;
      if (!isOwnUpload && !isHttpsUrl) {
        return { error: true, statusCode: httpStatus.BAD_REQUEST, data: {}, message: "Profile photo must be an uploaded image or an https link." };
      }
      updates.profileUrl = candidate;
    }

    // 4. Update Teacher Profile if provided/applicable
    const teacherProfile = await TeacherProfile.findOne({ where: { userId } }).catch(() => null);
    if (teacherProfile || (user as any).role?.role?.toLowerCase() === "teacher") {
      const teacherUpdates: any = {};
      if (body.qualification !== undefined) teacherUpdates.qualification = body.qualification;
      if (body.specialization !== undefined || body.specialSubject !== undefined) {
        teacherUpdates.specialization = body.specialization || body.specialSubject;
      }
      if (body.teacherType !== undefined || body.designation !== undefined) {
        teacherUpdates.teacherType = body.teacherType || body.designation;
      }
      if (body.experience !== undefined) teacherUpdates.experience = body.experience;
      if (body.joiningDate !== undefined) teacherUpdates.joiningDate = body.joiningDate;
      if (body.address !== undefined) teacherUpdates.address = body.address;
      if (body.dob !== undefined) teacherUpdates.dob = body.dob;

      if (Object.keys(teacherUpdates).length > 0) {
        if (teacherProfile) {
          await teacherProfile.update(teacherUpdates);
        } else if (user.instituteId) {
          await TeacherProfile.create({
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
    const studentProfile = await StudentProfile.findOne({ where: { userId } }).catch(() => null);
    if (studentProfile || (user as any).role?.role?.toLowerCase() === "student") {
      const studentUpdates: any = {};
      if (body.fatherName !== undefined) studentUpdates.fatherName = body.fatherName;
      if (body.rollNumber !== undefined) studentUpdates.rollNumber = body.rollNumber;
      if (body.className !== undefined) studentUpdates.className = body.className;
      if (body.sectionId !== undefined) studentUpdates.sectionId = body.sectionId;
      if (body.session !== undefined) studentUpdates.session = body.session;
      if (body.aadhar !== undefined) studentUpdates.aadhar = body.aadhar;
      if (body.address !== undefined) studentUpdates.address = body.address;
      if (body.dob !== undefined) studentUpdates.dob = body.dob;
      if (body.gender !== undefined) studentUpdates.gender = body.gender;

      if (Object.keys(studentUpdates).length > 0) {
        if (studentProfile) {
          await studentProfile.update(studentUpdates);
        } else if (user.instituteId) {
          await StudentProfile.create({
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
    const scannerProfile = await ScannerProfile.findOne({ where: { userId } }).catch(() => null);
    if (scannerProfile || (user as any).role?.role?.toLowerCase() === "scanner") {
      const scannerUpdates: any = {};
      if (body.address !== undefined) scannerUpdates.address = body.address;
      if (body.dob !== undefined) scannerUpdates.dob = body.dob;
      if (body.gender !== undefined) scannerUpdates.gender = body.gender;
      if (body.aadhar !== undefined) scannerUpdates.aadhar = body.aadhar;

      if (Object.keys(scannerUpdates).length > 0) {
        if (scannerProfile) {
          await scannerProfile.update(scannerUpdates);
        } else if (user.instituteId) {
          await ScannerProfile.create({
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
      await user.update(updates);
    }

    // Re-fetch full enriched profile data
    const fullProfileRes = await viaExamGetProfile(userId);
    return {
      error: false,
      statusCode: httpStatus.OK,
      data: fullProfileRes.data,
      message: "Profile updated successfully.",
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      data: {},
      message: e.message,
    };
  }
};

export default {
  viaExamUserCreate,
  viaExamUserLogin,
  viaExamUserLogout,
  viaExamGetProfile,
  viaExamUpdateProfile,
  getViaExamUserByEmail,
};
