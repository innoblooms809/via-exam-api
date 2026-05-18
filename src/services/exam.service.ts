import httpStatus from "http-status";
import Exam from "../modals/Exam.modal";
import UserModal from "../modals/User.modal";
import Role from "../modals/Role.modal";
import RegHelper from "../utils/helper";
import { Op } from "sequelize";

// ─── CREATE EXAM ──────────────────────────────────────────────────────────────
const createExam = async (body: any, createdBy: any): Promise<any> => {
  try {
    // 1. Get instituteId from logged in admin/examiner
    const instituteId = createdBy.instituteId;
    if (!instituteId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute not found for this user.",
      };
    }

    // 2. Validate teacher belongs to same institute
    const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });
    const teacher = await UserModal.findOne({
      where: {
        userId: body.teacherId,
        instituteId,
        roleId: teacherRole?.id,
        status: 1,
      },
    });
    console.log("Teacher Role =", teacherRole?.id);
    console.log("Institute =", instituteId);
    console.log("Teacher Name =", body.teacher);
    console.log("Teacher =", teacher);

    if (!teacher) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Teacher not found in your institute.",
      };
    }

    // 3. Check duplicate exam
    const duplicate = await Exam.findOne({
      where: {
        instituteId,
        sessionId: body.sessionId,
        examType: body.examType,
        subjectId: body.subjectId,
        isDeleted: false,
      },
    });

    if (duplicate) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message:
          "An exam with same session, type, class and subject already exists.",
      };
    }

    // 4. Generate exam ID
    const examId = await RegHelper.generateUserId();

    // 5. Create exam
    const exam = await Exam.create({
      examId,
      instituteId,
      sessionId: body.sessionId,
      examType: body.examType,
      classId: body.classId,
      subjectId: body.subjectId,
      teacherId: teacher.userId, // store userId not name
      examinerId: createdBy.userId,
      totalMarks: Number(body.totalMarks),
      passingMarks: Number(body.passingMarks),
      duration: body.duration ? Number(body.duration) : null,
      instructions: body.instructions || null,
      status: "Draft",
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Exam created successfully.",
      data: exam,
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

// ─── GET ALL EXAMS ────────────────────────────────────────────────────────────
const getAllExams = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const { search = "", status = "", classVal = "" } = query;

    const where: any = { instituteId, isDeleted: false };
    if (status) where.status = status;
    if (classVal) where.classVal = classVal;
    if (search) {
      where[Op.or] = [
        { examType: { [Op.iLike]: `%${search}%` } },
        { subject: { [Op.iLike]: `%${search}%` } },
        { classVal: { [Op.iLike]: `%${search}%` } },
      ];
    }

    const exams = await Exam.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exams fetched successfully.",
      data: { exams, total: exams.length },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── GET ONE EXAM ─────────────────────────────────────────────────────────────
const getExamById = async (examId: string, requestedBy: any): Promise<any> => {
  try {
    const exam = await Exam.findOne({
      where: { examId, isDeleted: false },
    });

    if (!exam) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    // Check institute access
    if (requestedBy.instituteId !== exam.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam fetched successfully.",
      data: exam,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE EXAM STATUS ───────────────────────────────────────────────────────
const updateExamStatus = async (
  examId: string,
  status: string,
  requestedBy: any,
): Promise<any> => {
  try {
    const allowed = ["Draft", "Live", "Completed"];
    if (!allowed.includes(status)) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Status must be one of: ${allowed.join(", ")}`,
      };
    }

    const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
    if (!exam) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    if (requestedBy.instituteId !== exam.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    await exam.update({ status });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Exam status updated to ${status}.`,
      data: exam,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── UPDATE EXAM  ───────────────────────────────────────────────────────
const updateExam = async (
  examId: string,
  body: any,
  requestedBy: any
): Promise<any> => {

  try {

    const instituteId = requestedBy.instituteId;

    const exam = await Exam.findOne({
      where: {
        examId,
        instituteId,
        isDeleted: false,
      },
    });

    if (!exam) {
      return {
        error: true,
        statusCode: 404,
        message: "Exam not found",
      };
    }

    // Optional Rule
    if (exam.status === "Completed") {
      return {
        error: true,
        statusCode: 400,
        message: "Completed exam cannot be updated",
      };
    }

    // Status Validation
    if (body.status) {

      const allowedStatus = ["Draft", "Live", "Completed"];

      if (!allowedStatus.includes(body.status)) {
        return {
          error: true,
          statusCode: 400,
          message: "Status must be one of: Draft, Live, Completed",
        };
      }
    }

    await exam.update({
      sessionId: body.session || exam.sessionId,
      examType: body.examType || exam.examType,
      subjectId: body.subject || exam.subjectId,
      totalMarks: body.totalMarks || exam.totalMarks,
      passingMarks: body.passingMarks || exam.passingMarks,
      duration: body.duration || exam.duration,
      instructions: body.instructions || exam.instructions,
      status: body.status || exam.status,
    });

    return {
      error: false,
      statusCode: 200,
      message: "Exam updated successfully",
      data: exam,
    };

  } catch (e: any) {

    return {
      error: true,
      statusCode: 500,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

// ─── SOFT DELETE EXAM ─────────────────────────────────────────────────────────
const deleteExam = async (examId: string, requestedBy: any): Promise<any> => {
  try {
    const exam = await Exam.findOne({ where: { examId, isDeleted: false } });
    if (!exam) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    if (requestedBy.instituteId !== exam.instituteId) {
      return {
        error: true,
        statusCode: httpStatus.FORBIDDEN,
        message: "Access denied.",
      };
    }

    await exam.update({ isDeleted: true });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam deleted successfully.",
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

export default {
  createExam,
  getAllExams,
  getExamById,
  updateExamStatus,
  updateExam,
  deleteExam,
};
