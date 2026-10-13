import httpStatus from "http-status";
import UserModal from "../../models/User.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import Role from "../../models/Role.model";
import Institute from "../../models/Institute.model";
import Class from "../../models/Class.model";
import Subject from "../../models/Subject.model";
import SubjectTeacher from "../../models/SubjectTeacher.model";
import QuestionPaper from "../../models/question-paper/QuestionPaper.model";
import QuestionPaperAnswer from "../../models/question-paper/StandardAnswer.model";
import Exam from "../../models/Exam.model";
import Session from "../../models/Session.model";
import EncryptPassword from "../../utils/encryption";
import RegHelper from "../../utils/helper";
import exclude from "../../utils/exclude";
import Section from "../../models/Section.model";
import { sequelize } from "../../config/sequelize";
import { Op } from "sequelize";
import { findStaff, teacherOpenWork } from "../academic/academicGuards.service";
import { newId } from "../../utils/idGenerator";
import { cleanEmail, contactTakenMessage, staffInputProblem } from "../../utils/staffInput";
import { TEACHER_TYPES, checkClassTeacherPost, isTeacherType, syncTeacherType } from "./classTeacher.service";
import {
  formatSpecializations,
  parseSpecializations,
  validateSpecializations,
} from "../../utils/specialization";

// ─── CREATE TEACHER ───────────────────────────────────────────────────────────
const createTeacher = async (
  body: any,
  files: any,
  createdBy: any,
): Promise<any> => {
  // Checks run before the transaction opens, so they never wait on its connection.
  const instituteId = createdBy.instituteId;
  if (!instituteId) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for this admin." };
  const problem = staffInputProblem(body, { requireDob: true, requireJoining: true, requireQualification: true });
  if (problem) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: problem };
  body.emailId = cleanEmail(body.emailId);
  body.phoneNumber = String(body.phoneNumber).trim();

  const institute = await Institute.findOne({ where: { instituteId, isDeleted: false, status: 1 } });
  if (!institute) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Institute not found or inactive." };
  const taken = await contactTakenMessage(body.emailId, body.phoneNumber, instituteId);
  if (taken) return { error: true, statusCode: httpStatus.CONFLICT, message: taken };
  const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });
  if (!teacherRole) return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "TEACHER role not found. Please seed roles." };

  const teacherType = body.teacherType || "Subject Teacher";
  if (!isTeacherType(teacherType)) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: `Teacher type must be one of: ${TEACHER_TYPES.join(", ")}.` };
  // A class teacher is created with the section they look after.
  let post: Section | null = null;
  if (teacherType === "Class Teacher") {
    if (!body.sectionId) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Choose the section this class teacher looks after." };
    const check = await checkClassTeacherPost(null, String(body.sectionId), instituteId);
    if ("message" in check) return { error: true, statusCode: check.status, message: check.message };
    post = check.section;
  }

  const t = await sequelize.transaction();
  try {
    // 7. Profile photo
    const profileUrl = files?.profilePhoto?.[0]
      ? `/${files.profilePhoto[0].path.replace(/\\/g, "/")}`
      : null;

    // 8. Create user record
    const plainPassword = body.password || (await RegHelper.generatePassword());
    const encryptedPassword = await EncryptPassword.encryptPassword(
      plainPassword,
    );
    const userId = newId("user");

    const newUser = await UserModal.create(
      {
        userId,
        userName: `${String(body.firstName).trim()} ${String(body.lastName).trim()}`,
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

        teacherType,
        qualification: String(body.qualification).trim(),
        specialization: formatSpecializations(parseSpecializations(body.specialization)) || null,
        experience: body.experience || null,
        address: body.address || null,
        joiningDate: new Date(body.joiningDate),
        dob: new Date(body.dob),
        profileUrl,
        isExaminer: false,
        examinerSince: null,
      },
      { transaction: t },
    );


    if (post) await Section.update({ classTeacherId: newUser.userId }, { where: { sectionId: post.sectionId }, transaction: t });

    // 10. Commit
    await t.commit();



    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Teacher created successfully.",
      data: {
        instituteName: institute.instituteName,
        plainPassword,
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

// ─── GET ALL TEACHERS (Production-Grade Server-Side Pagination & Indexed Search) ───
const getAllTeachers = async (createdBy: any, query: any): Promise<any> => {
  try {
    const pageNum = parseInt(query?.page || "1", 10);
    const limitNum = parseInt(query?.limit || "25", 10); // Default limit: 25 per user request
    const offset = (pageNum - 1) * limitNum;
    const search = (query?.search || "").trim();
    const isExaminer = query?.isExaminer || "";
    const teacherTypeFilter = query?.teacherType || "";
    const statusFilter = query?.status !== undefined && query?.status !== "" ? parseInt(query.status, 10) : null;
    const sortBy = query?.sortBy || "userName";
    const sortOrder = query?.sortOrder?.toUpperCase() === "DESC" ? "DESC" : "ASC";

    const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });

    const where: any = {
      instituteId: createdBy.instituteId,
      roleId: teacherRole?.id,
    };

    // Only add status filter if explicitly provided
    if (statusFilter !== null) {
      where.status = statusFilter;
    }

    // Indexed ILIKE search across Name, Email, and Phone
    if (search) {
      where[Op.or] = [
        { userName: { [Op.iLike]: `%${search}%` } },
        { emailId: { [Op.iLike]: `%${search}%` } },
        { phoneNumber: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const teacherProfileWhere: any = {};
    if (teacherTypeFilter) {
      teacherProfileWhere.teacherType = teacherTypeFilter;
    }
    if (isExaminer === "true") teacherProfileWhere.isExaminer = true;
    if (isExaminer === "false") teacherProfileWhere.isExaminer = false;

    const { count, rows: teachers } = await UserModal.findAndCountAll({
      where,
      include: [
        { model: Role, as: "role" },
        {
          model: TeacherProfile,
          as: "teacherProfile",
          required: Object.keys(teacherProfileWhere).length > 0,
          where: Object.keys(teacherProfileWhere).length > 0 ? teacherProfileWhere : undefined,
        },
      ],
      attributes: { exclude: ["password", "refreshToken"] },
      order: [[sortBy, sortOrder]],
      limit: limitNum,
      offset,
      distinct: true,
    });

    const teacherIds = teachers.map((u: any) => u.userId);

    const assignedClasses = await Class.findAll({
      where: {
        classTeacherId: { [Op.in]: teacherIds },
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    const assignedSections = await Section.findAll({
      where: {
        classTeacherId: { [Op.in]: teacherIds },
        instituteId: createdBy.instituteId,
        isDeleted: false,
        isActive: true,
      },
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"] },
      ],
    });

    const assignedSubjects = await Subject.findAll({
      where: {
        teacherId: { [Op.in]: teacherIds },
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
      include: [
        { model: Class, as: "class", attributes: ["classId", "className"], required: false },
        { model: Section, as: "section", attributes: ["sectionId", "sectionName"], required: false },
      ],
    });

    const result = teachers.map((u: any) => {
      const sec = assignedSections.find((s: any) => s.classTeacherId === u.userId);
      const cls = assignedClasses.find((c: any) => c.classTeacherId === u.userId);
      const subs = assignedSubjects.filter((s: any) => s.teacherId === u.userId);

      let assignedClass: any = null;
      if (sec) {
        assignedClass = {
          classId: sec.classId,
          className: (sec as any).class?.className || "",
          sectionId: sec.sectionId,
          sectionName: sec.sectionName,
        };
      } else if (cls) {
        assignedClass = {
          classId: cls.classId,
          className: cls.className,
          sectionId: null,
          sectionName: null,
        };
      }

      return {
        userId: u.userId,
        userName: u.userName,
        emailId: u.emailId,
        phoneNumber: u.phoneNumber,
        status: u.status,
        instituteId: u.instituteId,

        address: u.teacherProfile?.address ?? null,
        teacherType: u.teacherProfile?.teacherType ?? null,
        qualification: u.teacherProfile?.qualification ?? null,
        specialization: u.teacherProfile?.specialization ?? null,
        experience: u.teacherProfile?.experience ?? null,
        joiningDate: u.teacherProfile?.joiningDate ?? null,
        dob: u.teacherProfile?.dob ?? null,
        profileUrl: u.teacherProfile?.profileUrl ?? null,
        isExaminer: u.teacherProfile?.isExaminer ?? false,
        examinerSince: u.teacherProfile?.examinerSince ?? null,
        assignedClass,
        assignedSubjects: subs.map((s: any) => ({
          subjectId: s.subjectId,
          subjectName: s.subjectName,
          classId: s.classId,
          className: s.class?.className ?? null,
          sectionName: s.section?.sectionName ?? null,
        })),
        // Every section (or class) they are class teacher of.
        classTeacherOf: [
          ...assignedSections
            .filter((x: any) => x.classTeacherId === u.userId)
            .map((x: any) => ({ classId: x.classId, className: x.class?.className || "", sectionId: x.sectionId, sectionName: x.sectionName })),
          ...assignedClasses
            .filter((c: any) => c.classTeacherId === u.userId)
            .map((c: any) => ({ classId: c.classId, className: c.className, sectionId: null, sectionName: null })),
        ],
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teachers fetched successfully.",
      data: {
        teachers: result,
        total: count,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.ceil(count / limitNum),
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

    // Find assigned class if teacher is Class Teacher

    const assignedSection = await Section.findOne({
      where: { classTeacherId: userId, instituteId: createdBy.instituteId, isDeleted: false, isActive: true },
      include: [{ model: Class, as: "class", attributes: ["classId", "className"] }],
    });

    const assignedClass = await Class.findOne({
      where: { classTeacherId: userId, instituteId: createdBy.instituteId, isDeleted: false },
    });

    const teacherData: any = teacher.toJSON();
    if (assignedSection) {
      teacherData.assignedClass = {
        classId: assignedSection.classId,
        className: (assignedSection as any).class?.className || "",
        sectionId: assignedSection.sectionId,
        sectionName: assignedSection.sectionName,
      };
    } else if (assignedClass) {
      teacherData.assignedClass = {
        classId: assignedClass.classId,
        className: assignedClass.className,
        sectionId: null,
        sectionName: null,
      };
    } else {
      teacherData.assignedClass = null;
    }
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher fetched successfully.",
      data: teacherData,
      
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
  // Lookups and checks run before the transaction opens.
  const instituteId = createdBy.instituteId;
  const user = await findStaff(userId, instituteId, "TEACHER");
  if (!user) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Teacher not found." };
  const profile = await TeacherProfile.findOne({ where: { userId } });

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
  if (body.specialization !== undefined) {
    const specProblem = validateSpecializations(parseSpecializations(body.specialization));
    if (specProblem) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: specProblem };
  }
  // Type and class-teacher post.
  if (body.teacherType !== undefined && !isTeacherType(body.teacherType)) {
    return { error: true, statusCode: httpStatus.BAD_REQUEST, message: `Teacher type must be one of: ${TEACHER_TYPES.join(", ")}.` };
  }
  const nextType = body.teacherType ?? profile?.teacherType ?? "Subject Teacher";
  let post: Section | null = null;
  if (nextType === "Class Teacher" && body.sectionId) {
    const check = await checkClassTeacherPost(userId, String(body.sectionId), instituteId, { teacherType: nextType });
    if ("message" in check) return { error: true, statusCode: check.status, message: check.message };
    post = check.section;
  } else if (nextType === "Class Teacher" && body.teacherType === "Class Teacher" && profile?.teacherType !== "Class Teacher") {
    const holds = await Section.count({ where: { instituteId, classTeacherId: userId, isDeleted: false } });
    if (!holds) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Choose the section this class teacher looks after." };
  }
  const dates: { dob?: Date; joiningDate?: Date } = {};
  for (const k of ["dob", "joiningDate"] as const) {
    if (body[k] === undefined || body[k] === "") continue;
    const d = new Date(body[k]);
    if (Number.isNaN(d.getTime())) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: `Enter a valid ${k === "dob" ? "date of birth" : "joining date"}.` };
    dates[k] = d;
  }

  const t = await sequelize.transaction();
  try {
    await user.update(
      {
        userName: first && last ? `${first} ${last}` : user.userName,
        phoneNumber: phone ?? user.phoneNumber,
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
          teacherType: nextType,
          qualification: body.qualification ?? profile.qualification,
          specialization:
            body.specialization !== undefined
              ? formatSpecializations(parseSpecializations(body.specialization)) || null
              : profile.specialization,
          experience: body.experience ?? profile.experience,
          address: body.address ?? profile.address,
          ...(dates.dob ? { dob: dates.dob } : {}),
          ...(dates.joiningDate ? { joiningDate: dates.joiningDate } : {}),
          profileUrl,
        },
        { transaction: t },
      );

      // Only a Class Teacher holds a section: changing to another type gives it up, and a
      // new section replaces the old one. (Older records may hold a section under another
      // stored type; an edit that doesn't change the type leaves that alone.)
      if ((body.teacherType !== undefined && nextType !== "Class Teacher") || post) {
        await Class.update({ classTeacherId: null }, { where: { classTeacherId: userId, instituteId }, transaction: t });
        await Section.update({ classTeacherId: null }, { where: { classTeacherId: userId, instituteId }, transaction: t });
      }
      if (post) await Section.update({ classTeacherId: userId }, { where: { sectionId: post.sectionId }, transaction: t });
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
// Refused while the teacher still has papers to set, exams to evaluate or rechecks
// to finish. Their subjects and class-teacher posts are freed, so the setup
// checklist shows what needs a new teacher.
const deleteTeacher = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    const user = await findStaff(userId, instituteId, "TEACHER");
    if (!user) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Teacher not found." };

    const work = await teacherOpenWork(userId, instituteId);
    if (work.total) return { error: true, statusCode: httpStatus.CONFLICT, message: work.message };

    const freed = await sequelize.transaction(async (t) => {
      await user.update({ status: 0, refreshToken: null }, { transaction: t });
      await Class.update({ classTeacherId: null }, { where: { classTeacherId: userId, instituteId }, transaction: t });
      await Section.update({ classTeacherId: null }, { where: { classTeacherId: userId, instituteId }, transaction: t });
      await syncTeacherType(userId, instituteId, t);
      const [subjects] = await Subject.update({ teacherId: null }, { where: { teacherId: userId, instituteId, isDeleted: false }, transaction: t });
      return subjects;
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: freed
        ? `${user.userName} deactivated. ${freed} ${freed === 1 ? "subject now needs" : "subjects now need"} a new teacher.`
        : `${user.userName} deactivated.`,
      data: { subjectsFreed: freed },
    };
  } catch (e: any) {
    console.error("Delete teacher error:", e);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
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

// ─── GET DEACTIVATED TEACHERS ──────────────────────────────────────────────────
const getDeactivatedTeachers = async (createdBy: any, query: any): Promise<any> => {
  try {
    const { search = "" } = query;
    const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });

    const where: any = {
      instituteId: createdBy.instituteId,
      roleId: teacherRole?.id,
      status: 0, // 0 = Deactivated
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

    const result = teachers.map((u: any) => ({
      userId: u.userId,
      userName: u.userName,
      emailId: u.emailId,
      phoneNumber: u.phoneNumber,
      status: u.status,
      instituteId: u.instituteId,

      address: u.teacherProfile?.address ?? null,
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

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Deactivated teachers fetched successfully.",
      data: {
        teachers: result,
        total: result.length,
      },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: e.message,
    };
  }
};

// ─── REACTIVATE TEACHER ──────────────────────────────────────────────────────
const reactivateTeacher = async (userId: string, createdBy: any): Promise<any> => {
  try {
    const user = await findStaff(userId, createdBy.instituteId, "TEACHER");
    if (!user) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Teacher not found." };
    await user.update({ status: 1 });
    return { error: false, statusCode: httpStatus.OK, message: `${user.userName} reactivated. Assign their subjects again under Subject Teachers.`, data: {} };
  } catch (e: any) {
    console.error("Reactivate teacher error:", e);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

// ─── GET MY ASSIGNMENTS ─────────────────────────────────────────────────────────
const getMyAssignments = async (teacherId: string): Promise<any> => {
  try {
    const user = await UserModal.findOne({ where: { userId: teacherId } });
    const instituteId = user?.instituteId;

    const activeSession = instituteId
      ? await Session.findOne({
          where: { instituteId, isActive: true, isDeleted: false },
        })
      : null;

    const assignedSubjects = await Subject.findAll({
      where: {
        teacherId,
        isActive: true,
        isDeleted: false,
      },
      include: [
        {
          model: Class,
          as: "class",
          attributes: ["classId", "className"],
          required: false,
        },
        {
          model: Section,
          as: "section",
          attributes: ["sectionId", "sectionName"],
          required: false,
        },
      ],
    });

    const assignedClasses = await Class.findAll({
      where: {
        classTeacherId: teacherId,
        isActive: true,
        isDeleted: false,
      },
      include: [
        {
          model: Section,
          as: "sections",
          attributes: ["sectionId", "sectionName"],
          required: false,
        },
      ],
    });

    const assignedSections = await Section.findAll({
      where: {
        classTeacherId: teacherId,
        isActive: true,
        isDeleted: false,
      },
      include: [
        {
          model: Class,
          as: "class",
          attributes: ["classId", "className"],
          required: false,
        },
      ],
    });

    // Fetch all active sections for the classes where the teacher teaches subjects
    const subjectClassIds = Array.from(
      new Set(assignedSubjects.map((s: any) => s.classId).filter(Boolean))
    );

    const classSectionsList = subjectClassIds.length > 0
      ? await Section.findAll({
          where: {
            classId: { [Op.in]: subjectClassIds },
            isActive: true,
            isDeleted: false,
          },
          attributes: ["sectionId", "classId", "sectionName"],
          order: [["sectionName", "ASC"]],
        })
      : [];

    const classSectionsMap = new Map<string, any[]>();
    classSectionsList.forEach((sec: any) => {
      const plainSec = sec.get({ plain: true });
      const list = classSectionsMap.get(plainSec.classId) || [];
      list.push(plainSec);
      classSectionsMap.set(plainSec.classId, list);
    });

    // Group assigned subjects by classId + subjectName so multiple section entries merge
    const groupedSubjectMap = new Map<string, any>();

    for (const s of assignedSubjects) {
      const plain: any = s.get({ plain: true });
      const className = plain.class?.className || plain.className || "";
      const subjectNameKey = (plain.subjectName || "").trim().toLowerCase();
      const groupKey = `${plain.classId || className}_${subjectNameKey}`;

      let secs: any[] = [];
      if (plain.sectionId && plain.section) {
        secs = [plain.section];
      } else if (plain.sectionId && !plain.section) {
        const foundSec = classSectionsList.find(
          (sec: any) => sec.sectionId === plain.sectionId
        );
        if (foundSec) secs = [foundSec.get({ plain: true })];
      } else {
        secs = classSectionsMap.get(plain.classId) || [];
      }

      if (!groupedSubjectMap.has(groupKey)) {
        groupedSubjectMap.set(groupKey, {
          ...plain,
          className,
          sections: [...secs],
          sessionName: activeSession ? activeSession.sessionName : null,
        });
      } else {
        const existing = groupedSubjectMap.get(groupKey);
        const existingKeys = new Set(
          existing.sections.map((sec: any) => sec.sectionId || sec.sectionName)
        );
        for (const sec of secs) {
          const key = sec.sectionId || sec.sectionName;
          if (!existingKeys.has(key)) {
            existingKeys.add(key);
            existing.sections.push(sec);
          }
        }
      }
    }

    const formattedSubjects = Array.from(groupedSubjectMap.values()).map((sub: any) => {
      let sectionNameStr = "All Sections";
      if (sub.sections && sub.sections.length > 0) {
        const cleanNames = Array.from(
          new Set(
            sub.sections
              .map((sec: any) =>
                (sec.sectionName || "").replace(/^(sec|section)\s*/i, "").trim()
              )
              .filter(Boolean)
          )
        );
        if (cleanNames.length > 0) {
          sectionNameStr = cleanNames.map((name: any) => `Sec ${name}`).join(", ");
        }
      }
      return {
        ...sub,
        sectionName: sectionNameStr,
      };
    });

    const formattedClasses = assignedClasses.map((c: any) => {
      const plain: any = c.get({ plain: true });
      let secName = "All Sections";
      if (plain.sections && plain.sections.length > 0) {
        const cleanNames = Array.from(
          new Set(
            plain.sections
              .map((s: any) => (s.sectionName || "").replace(/^(sec|section)\s*/i, "").trim())
              .filter(Boolean)
          )
        );
        if (cleanNames.length > 0) {
          secName = cleanNames.map((name: any) => `Sec ${name}`).join(", ");
        }
      }
      return {
        ...plain,
        sectionName: secName,
        sessionName: activeSession ? activeSession.sessionName : null,
      };
    });

    const formattedSections = assignedSections.map((sec: any) => {
      const plain = sec.get({ plain: true });
      const rawName = plain.sectionName ? plain.sectionName.replace(/^(sec|section)\s*/i, "").trim() : "";
      return {
        ...plain,
        sectionName: rawName ? `Sec ${rawName}` : "—",
        sessionName: activeSession ? activeSession.sessionName : null,
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Assignments fetched successfully",
      data: {
        assignedSubjects: formattedSubjects,
        assignedClasses: formattedClasses,
        assignedSections: formattedSections,
        activeSession: activeSession ? activeSession.sessionName : null,
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

const getTeacherQuestionPapers = async (
  teacherUser: any,
  query: any,
  targetUserId?: string
): Promise<any> => {
  try {
    const teacherId = targetUserId || query?.teacherId || teacherUser?.userId;
    const instituteId = teacherUser?.instituteId;

    if (!teacherId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Teacher ID is required.",
      };
    }

    const where: any = { teacherId };
    if (instituteId) {
      where.instituteId = instituteId;
    }
    if (query?.status) {
      where.status = query.status;
    }
    if (query?.paperSet) {
      where.paperSet = query.paperSet;
    }

    const papers = await QuestionPaper.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    const examIds = Array.from(new Set(papers.map((p) => p.examId).filter(Boolean)));
    const exams = examIds.length > 0
      ? await Exam.findAll({ where: { examId: { [Op.in]: examIds } } })
      : [];

    const examMap = new Map<string, any>(exams.map((e) => [e.examId, e]));

    // Answer sheet of each paper's set (typed answers or an uploaded PDF).
    const answerSheets = examIds.length > 0
      ? await QuestionPaperAnswer.findAll({ where: { examId: { [Op.in]: examIds } } })
      : [];
    const answerByPaperId = new Map<string, any>();
    const answerByExamSet = new Map<string, any>();
    answerSheets.forEach((a) => {
      const plain = a.get({ plain: true });
      answerByPaperId.set(plain.paperId, plain);
      answerByExamSet.set(`${plain.examId}:${plain.paperSet}`, plain);
    });

    const classIds = Array.from(new Set(exams.map((e) => e.classId).filter(Boolean))) as string[];
    const subjectIds = Array.from(new Set(exams.map((e) => e.subjectId).filter(Boolean))) as string[];
    const sessionIds = Array.from(new Set(exams.map((e) => e.sessionId).filter(Boolean))) as string[];

    const [classesList, subjectsList, sessionsList] = await Promise.all([
      classIds.length > 0 ? Class.findAll({ where: { classId: { [Op.in]: classIds } } }) : [],
      subjectIds.length > 0 ? Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds } } }) : [],
      sessionIds.length > 0 ? Session.findAll({ where: { sessionId: { [Op.in]: sessionIds } } }) : [],
    ]);

    const classMap = new Map<string, string>(classesList.map((c: any) => [c.classId, c.className]));
    const subjectMap = new Map<string, string>(subjectsList.map((s: any) => [s.subjectId, s.subjectName]));
    const sessionMap = new Map<string, string>(sessionsList.map((s: any) => [s.sessionId, s.sessionName]));

    const formattedPapers = papers.map((p) => {
      const plainPaper: any = p.get({ plain: true });
      const exam = examMap.get(p.examId);
      const className = exam?.classId ? classMap.get(exam.classId) || exam.classId : "All Classes";
      const subjectName = exam?.subjectId ? subjectMap.get(exam.subjectId) || exam.subjectId : "General Subject";
      const sessionName = exam?.sessionId ? sessionMap.get(exam.sessionId) || exam.sessionId : "";
      const answerSheet =
        answerByPaperId.get(plainPaper.paperId) ||
        answerByExamSet.get(`${plainPaper.examId}:${plainPaper.paperSet}`) ||
        null;

      return {
        ...plainPaper,
        answerSheet: answerSheet
          ? {
              answerId: answerSheet.answerId,
              paperSet: answerSheet.paperSet,
              status: answerSheet.status,
              answers: answerSheet.answers,
              kind: answerSheet.answers?.pdfUrl ? "file" : "manual",
              updatedAt: answerSheet.updatedAt,
            }
          : null,
        examDetails: exam ? {
          examId: exam.examId,
          examType: exam.examType,
          totalMarks: exam.totalMarks,
          duration: exam.duration,
          className,
          subjectName,
          sessionName,
        } : null,
        className,
        subjectName,
        examName: exam?.examType || plainPaper.content?.meta?.examName || "Examination",
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher question papers fetched successfully.",
      data: {
        total: formattedPapers.length,
        papers: formattedPapers,
      },
    };
  } catch (error: any) {
    console.error("getTeacherQuestionPapers Service Error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to fetch teacher question papers: ${error.message}`,
    };
  }
};

// ─── SPECIALISATIONS ─────────────────────────────────────────────────────────
// Replaces a teacher's specialisation list. Subjects (and exams) can only go to teachers
// who specialise in them — see services/teacher/teacherSubject.service.ts.
const updateSpecializations = async (userId: string, body: any, requestedBy: any): Promise<any> => {
  try {
    const list = parseSpecializations(body?.specializations);
    const problem = validateSpecializations(list);
    if (problem) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: problem };

    const profile = await TeacherProfile.findOne({ where: { userId, instituteId: requestedBy.instituteId } });
    if (!profile) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Teacher not found." };

    await profile.update({ specialization: formatSpecializations(list) || null });
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: list.length ? `Specialisations updated: ${formatSpecializations(list)}.` : "Specialisations cleared.",
      data: { userId, specialization: profile.specialization, specializations: list },
    };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Failed to update specialisations: ${e.message}` };
  }
};

export default {
  createTeacher,
  updateSpecializations,
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
  assignExaminer,
  removeExaminer,
  getDeactivatedTeachers,
  reactivateTeacher,
  getMyAssignments,
  getTeacherQuestionPapers,
  getTeacherExamsWithApprovalStatus: async (
    teacherUser: any,
    query: any,
    targetUserId?: string
  ): Promise<any> => {
    try {
      const QuestionPaperAnswer = (await import(
        "../../models/question-paper/StandardAnswer.model"
      )).default;

      const teacherId = targetUserId || query?.teacherId || teacherUser?.userId;
      const instituteId = teacherUser?.instituteId;

      if (!teacherId) {
        return {
          error: true,
          statusCode: httpStatus.BAD_REQUEST,
          message: "Teacher ID is required.",
        };
      }

      const whereExam: any = { teacherId };
      if (instituteId) {
        whereExam.instituteId = instituteId;
      }

      const exams = await Exam.findAll({
        where: whereExam,
        order: [["createdAt", "DESC"]],
      });

      const examIds = exams.map((e) => e.examId);

      const [papers, answers, classesList, subjectsList, sessionsList] = await Promise.all([
        examIds.length > 0 ? QuestionPaper.findAll({ where: { examId: { [Op.in]: examIds } } }) : [],
        examIds.length > 0 ? QuestionPaperAnswer.findAll({ where: { examId: { [Op.in]: examIds } } }) : [],
        Class.findAll({ where: { instituteId, isDeleted: false } }),
        Subject.findAll({ where: { instituteId, isDeleted: false } }),
        Session.findAll({ where: { instituteId } }),
      ]);

      const classMap = new Map<string, string>(classesList.map((c: any) => [c.classId, c.className]));
      const subjectMap = new Map<string, string>(subjectsList.map((s: any) => [s.subjectId, s.subjectName]));
      const sessionMap = new Map<string, string>(sessionsList.map((s: any) => [s.sessionId, s.sessionName]));

      const paperMap = new Map<string, any[]>();
      papers.forEach((p) => {
        const list = paperMap.get(p.examId) || [];
        list.push(p.get({ plain: true }));
        paperMap.set(p.examId, list);
      });

      const answerMap = new Map<string, any[]>();
      answers.forEach((a) => {
        const list = answerMap.get(a.examId) || [];
        list.push(a.get({ plain: true }));
        answerMap.set(a.examId, list);
      });

      const result = exams.map((exam) => {
        const qpList = paperMap.get(exam.examId) || [];
        const ansList = answerMap.get(exam.examId) || [];

        const qp = qpList[0] || null;
        const ans = ansList[0] || null;

        let workflowStatus = "DRAFT";
        if (!qp && !ans) {
          workflowStatus = "BOTH_MISSING";
        } else if (!qp) {
          workflowStatus = "QP_MISSING";
        } else if (!ans) {
          workflowStatus = "ANSWER_MISSING";
        } else if (qp.status === "REJECTED" || ans.status === "REJECTED") {
          workflowStatus = "REJECTED";
        } else if (qp.status === "PENDING_APPROVAL" || ans.status === "PENDING_APPROVAL") {
          workflowStatus = "PENDING_APPROVAL";
        } else if (
          (qp.status === "APPROVED" || qp.status === "PUBLISHED") &&
          (ans.status === "APPROVED" || ans.status === "PUBLISHED")
        ) {
          workflowStatus = "APPROVED";
        }

        const className = exam.classId ? classMap.get(exam.classId) || exam.classId : "All Classes";
        const subjectName = exam.subjectId ? subjectMap.get(exam.subjectId) || exam.subjectId : "General Subject";
        const sessionName = exam.sessionId ? sessionMap.get(exam.sessionId) || exam.sessionId : "";

        return {
          examId: exam.examId,
          examType: exam.examType,
          totalMarks: exam.totalMarks,
          passingMarks: exam.passingMarks,
          duration: exam.duration,
          status: exam.status,
          className,
          subjectName,
          sessionName,
          workflowStatus,
          rejectionNote: qp?.rejectionNote || ans?.rejectionNote || null,
          questionPaper: qp,
          answerSheet: ans,
        };
      });

      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "Teacher approval workflow exams fetched successfully.",
        data: {
          total: result.length,
          exams: result,
        },
      };
    } catch (error: any) {
      console.error("getTeacherExamsWithApprovalStatus Error:", error);
      return {
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: `Failed to fetch approval workflow exams: ${error.message}`,
      };
    }
  },
};
