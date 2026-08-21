import httpStatus from "http-status";
import UserModal from "../modals/User.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import Role from "../modals/Role.modal";
import Institute from "../modals/Institute.modal";
import Class from "../modals/Class.modal";
import Subject from "../modals/Subject.modal";
import SubjectTeacher from "../modals/SubjectTeacher.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import Exam from "../modals/Exam.modal";
import Session from "../modals/Session.modal";
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

    // Validate class assignment: ensure class does not already have a class teacher
    if (body.teacherType === "Class Teacher" && body.classId) {
      const cls = await Class.findOne({
        where: { classId: body.classId, instituteId, isDeleted: false },
        transaction: t,
      });
      if (cls && cls.classTeacherId) {
        const existingTeacher = await UserModal.findOne({
          where: { userId: cls.classTeacherId, instituteId },
          transaction: t,
        });
        const teacherName = existingTeacher ? existingTeacher.userName : "another teacher";
        await t.rollback();
        return {
          error: true,
          statusCode: httpStatus.BAD_REQUEST,
          message: `Class "${cls.className}" already has a Class Teacher assigned: ${teacherName}. Please choose a different class.`,
        };
      }
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

        teacherType: body.teacherType,
        qualification: body.qualification,
        specialization: body.specialization || null,
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


    // Assign teacher to Class if they are a Class Teacher
    if (body.teacherType === "Class Teacher" && body.classId) {
      const cls = await Class.findOne({
        where: { classId: body.classId, instituteId },
        transaction: t,
      });
      if (cls) {
        await cls.update({ classTeacherId: newUser.userId }, { transaction: t });
      } else {
      }
    }

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

    const teacherIds = teachers.map((u: any) => u.userId);

    const assignedClasses = await Class.findAll({
      where: {
        classTeacherId: { [Op.in]: teacherIds },
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    const assignedSubjects = await Subject.findAll({
      where: {
        teacherId: { [Op.in]: teacherIds },
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    let result = teachers.map((u: any) => {
      const cls = assignedClasses.find((c: any) => c.classTeacherId === u.userId);
      const subs = assignedSubjects.filter((s: any) => s.teacherId === u.userId);

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
        assignedClass: cls ? { classId: cls.classId, className: cls.className } : null,
        assignedSubjects: subs.map((s: any) => ({ subjectId: s.subjectId, subjectName: s.subjectName })),
      };
    });

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

    // Find assigned class if teacher is Class Teacher

    const allClassesForTeacher = await Class.findAll({
      where: { classTeacherId: userId }
    });

    const assignedClass = await Class.findOne({
      where: { classTeacherId: userId, instituteId: createdBy.instituteId, isDeleted: false },
    });

    const teacherData: any = teacher.toJSON();
    if (assignedClass) {
      teacherData.assignedClass = {
        classId: assignedClass.classId,
        className: assignedClass.className,
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
          address: body.address ?? profile.address,
          profileUrl,
        },
        { transaction: t },
      );

      // If teacherType is updated to something other than "Class Teacher",
      // remove them as class teacher from any class they were assigned to.
      const newTeacherType = body.teacherType ?? profile.teacherType;
      if (newTeacherType !== "Class Teacher") {
        const cls = await Class.findOne({
          where: { classTeacherId: userId, instituteId: createdBy.instituteId },
          transaction: t,
        });
        if (cls) {
          await cls.update({ classTeacherId: null }, { transaction: t });
        }
      } else {
        // If teacher is a Class Teacher and classId is updated
        if (body.classId !== undefined) {
          // 1. Clear this teacher from any class they are currently assigned to
          await Class.update(
            { classTeacherId: null },
            { where: { classTeacherId: userId, instituteId: createdBy.instituteId }, transaction: t }
          );

          // 2. If a classId is specified, validate and assign it
          if (body.classId) {
            const newClass = await Class.findOne({
              where: { classId: body.classId, instituteId: createdBy.instituteId, isDeleted: false },
              transaction: t,
            });

            if (newClass) {
              // Ensure that class is not already assigned to another teacher!
              if (newClass.classTeacherId && newClass.classTeacherId !== userId) {
                const existingTeacher = await UserModal.findOne({
                  where: { userId: newClass.classTeacherId, instituteId: createdBy.instituteId },
                  transaction: t,
                });
                const teacherName = existingTeacher ? existingTeacher.userName : "another teacher";
                await t.rollback();
                return {
                  error: true,
                  statusCode: httpStatus.BAD_REQUEST,
                  message: `Class "${newClass.className}" already has a Class Teacher assigned: ${teacherName}. Please choose a different class.`,
                };
              }
              await newClass.update({ classTeacherId: userId }, { transaction: t });
            }
          }
        }
      }
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

    // Unassign teacher from any class they were teaching
    const assignedClass = await Class.findOne({
      where: { classTeacherId: userId, instituteId: createdBy.instituteId },
    });
    if (assignedClass) {
      await assignedClass.update({ classTeacherId: null });
    }

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

    await user.update({ status: 1 });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher reactivated successfully.",
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

// ─── GET MY ASSIGNMENTS ─────────────────────────────────────────────────────────
const getMyAssignments = async (teacherId: string): Promise<any> => {
  try {
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
      ],
    });

    const assignedClasses = await Class.findAll({
      where: {
        classTeacherId: teacherId,
        isActive: true,
        isDeleted: false,
      },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Assignments fetched successfully",
      data: {
        assignedSubjects,
        assignedClasses,
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

      return {
        ...plainPaper,
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

export default {
  createTeacher,
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
};
