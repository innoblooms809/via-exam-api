import httpStatus from "http-status";
import { Op } from "sequelize";
import Class from "../modals/Class.modal";
import Exam from "../modals/Exam.modal";
import Session from "../modals/Session.modal";
import Subject from "../modals/Subject.modal";
import UserModal from "../modals/User.modal";
import Role from "../modals/Role.modal";
import RegHelper from "../utils/helper";

const ACTIVE_USER_STATUS = 1;
const EXAM_STATUSES = ["Draft", "Live", "Completed"];

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const parseOptionalNumber = (value: unknown): number | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseRequiredNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const getTeacherRoleId = async (): Promise<number | null> => {
  const teacherRole = await Role.findOne({ where: { role: "TEACHER" } });
  return teacherRole?.id ?? null;
};

const getTeacher = async (
  teacherId: string,
  instituteId: string,
): Promise<any> => {
  const teacherRoleId = await getTeacherRoleId();
  if (!teacherRoleId) {
    return null;
  }

  return UserModal.findOne({
    where: {
      userId: teacherId,
      instituteId,
      roleId: teacherRoleId,
      status: ACTIVE_USER_STATUS,
      isDeleted: false,
    },
  });
};

const getInstituteUser = async (
  userId: string,
  instituteId: string,
): Promise<any> =>
  UserModal.findOne({
    where: {
      userId,
      instituteId,
      status: ACTIVE_USER_STATUS,
      isDeleted: false,
    },
  });

const getSession = async (sessionId: string, instituteId: string): Promise<any> =>
  Session.findOne({
    where: {
      sessionId,
      instituteId,
      isDeleted: false,
    },
  });

const getClass = async (
  classId: string,
  instituteId: string,
): Promise<any> =>
  Class.findOne({
    where: {
      classId,
      instituteId,
      isDeleted: false,
    },
  });

const getSubject = async (
  subjectId: string,
  instituteId: string,
): Promise<any> =>
  Subject.findOne({
    where: {
      subjectId,
      instituteId,
      isDeleted: false,
      isActive: true,
    },
  });

const validateExamPayload = async (
  body: any,
  instituteId: string,
  options: {
    currentExam?: any;
    requireMandatoryFields: boolean;
  },
) => {
  const requireField = (value: string | undefined, field: string) => {
    if (options.requireMandatoryFields && !value) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `${field} is required.`,
      };
    }

    return null;
  };

  const sessionId = normalizeString(body.sessionId);
  const classId = normalizeString(body.classId);
  const subjectId = normalizeString(body.subjectId);
  const teacherId = normalizeString(body.teacherId);
  const examinerId =
    body.examinerId === null || body.examinerId === ""
      ? null
      : normalizeString(body.examinerId);
  const examType = normalizeString(body.examType);
  const instructions =
    body.instructions === null
      ? null
      : typeof body.instructions === "string"
        ? body.instructions.trim() || null
        : undefined;
  const status = normalizeString(body.status);
  const totalMarks = parseRequiredNumber(body.totalMarks);
  const passingMarks = parseRequiredNumber(body.passingMarks);
  const duration = parseOptionalNumber(body.duration);

  const missingSession = requireField(sessionId, "sessionId");
  if (missingSession) return missingSession;

  const missingSubject = requireField(subjectId, "subjectId");
  if (missingSubject) return missingSubject;

  const missingTeacher = requireField(teacherId, "teacherId");
  if (missingTeacher) return missingTeacher;

  const missingType = requireField(examType, "examType");
  if (missingType) return missingType;

  if (options.requireMandatoryFields && totalMarks === undefined) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: "totalMarks is required and must be a number.",
    };
  }

  if (options.requireMandatoryFields && passingMarks === undefined) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: "passingMarks is required and must be a number.",
    };
  }

  if (body.totalMarks !== undefined && totalMarks === undefined) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: "totalMarks must be a valid number.",
    };
  }

  if (body.passingMarks !== undefined && passingMarks === undefined) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: "passingMarks must be a valid number.",
    };
  }

  if (body.duration !== undefined && duration === undefined) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: "duration must be a valid number.",
    };
  }

  const resolvedStatus = status ?? options.currentExam?.status;
  if (status && !EXAM_STATUSES.includes(status)) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: `Status must be one of: ${EXAM_STATUSES.join(", ")}`,
    };
  }

  const resolvedTotalMarks = totalMarks ?? options.currentExam?.totalMarks;
  const resolvedPassingMarks = passingMarks ?? options.currentExam?.passingMarks;
  if (
    resolvedTotalMarks !== undefined &&
    resolvedPassingMarks !== undefined &&
    resolvedPassingMarks > resolvedTotalMarks
  ) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: "Passing marks cannot be greater than total marks.",
    };
  }

  const resolvedSessionId = sessionId ?? options.currentExam?.sessionId;
  const resolvedTeacherId = teacherId ?? options.currentExam?.teacherId;
  const resolvedSubjectId = subjectId ?? options.currentExam?.subjectId;

  let session = null;
  if (resolvedSessionId) {
    session = await getSession(resolvedSessionId, instituteId);
    if (!session) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Session not found in your institute.",
      };
    }
  }

  let teacher = null;
  if (resolvedTeacherId) {
    teacher = await getTeacher(resolvedTeacherId, instituteId);
    if (!teacher) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Teacher not found in your institute.",
      };
    }
  }

  let subject = null;
  if (resolvedSubjectId) {
    subject = await getSubject(resolvedSubjectId, instituteId);
    if (!subject) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Subject not found in your institute.",
      };
    }
  }

  const requestedClassId =
    classId ??
    (body.classId === null ? null : undefined) ??
    options.currentExam?.classId;
  const resolvedClassId =
    requestedClassId === undefined ? subject?.classId ?? null : requestedClassId;

  let classData = null;
  if (resolvedClassId) {
    classData = await getClass(resolvedClassId, instituteId);
    if (!classData) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Class not found in your institute.",
      };
    }
  }

  if (subject && resolvedClassId && subject.classId !== resolvedClassId) {
    return {
      error: true,
      statusCode: httpStatus.BAD_REQUEST,
      message: "The selected subject does not belong to the selected class.",
    };
  }

  let examiner = null;
  const resolvedExaminerId =
    examinerId === null
      ? null
      : examinerId ?? options.currentExam?.examinerId ?? null;
  if (resolvedExaminerId) {
    examiner = await getInstituteUser(resolvedExaminerId, instituteId);
    if (!examiner) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Examiner not found in your institute.",
      };
    }
  }

  return {
    error: false,
    values: {
      session,
      classData,
      subject,
      teacher,
      examiner,
      sessionId: resolvedSessionId,
      classId: resolvedClassId ?? null,
      subjectId: resolvedSubjectId,
      teacherId: resolvedTeacherId,
      examinerId: resolvedExaminerId,
      examType,
      totalMarks,
      passingMarks,
      duration,
      instructions,
      status: resolvedStatus,
    },
  };
};

const createExam = async (body: any, createdBy: any): Promise<any> => {
  try {
    const instituteId = createdBy.instituteId;
    if (!instituteId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Institute not found for this user.",
      };
    }

    const validation = await validateExamPayload(body, instituteId, {
      requireMandatoryFields: true,
    });
    if (validation.error) {
      return validation;
    }

    const values = (validation as any).values;
    const duplicate = await Exam.findOne({
      where: {
        instituteId,
        sessionId: values.sessionId,
        classId: values.classId,
        subjectId: values.subjectId,
        examType: values.examType,
        isDeleted: false,
      },
    });

    if (duplicate) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message:
          "An exam with the same session, class, subject, type, and date already exists.",
      };
    }

    const examId = await RegHelper.generateUserId();
    const exam = await Exam.create({
      examId,
      instituteId,
      sessionId: values.sessionId,
      classId: values.classId,
      examType: values.examType!,
      subjectId: values.subjectId!,
      teacherId: values.teacherId!,
      examinerId: values.examinerId,
      totalMarks: values.totalMarks!,
      passingMarks: values.passingMarks!,
      duration: values.duration ?? null,
      instructions: values.instructions ?? null,
      status: "Draft",
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Exam created successfully.",
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

const getAllExams = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const {
      status = "",
      sessionId = "",
      classId = "",
      subjectId = "",
      teacherId = "",
      examinerId = "",
      search = "",
    } = query;

    const where: any = {
      instituteId,
      isDeleted: false,
    };

    if (status) where.status = status;
    if (sessionId) where.sessionId = sessionId;
    if (classId) where.classId = classId;
    if (subjectId) where.subjectId = subjectId;
    if (teacherId) where.teacherId = teacherId;
    if (examinerId) where.examinerId = examinerId;
    if (search) {
      where[Op.or] = [
        { examType: { [Op.iLike]: `%${search}%` } },
        { examId: { [Op.iLike]: `%${search}%` } },
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

const updateExamStatus = async (
  examId: string,
  status: string,
  requestedBy: any,
): Promise<any> => {
  try {
    if (!EXAM_STATUSES.includes(status)) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: `Status must be one of: ${EXAM_STATUSES.join(", ")}`,
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

const updateExam = async (
  examId: string,
  body: any,
  requestedBy: any,
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
        statusCode: httpStatus.NOT_FOUND,
        message: "Exam not found.",
      };
    }

    if (exam.status === "Completed") {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Completed exam cannot be updated.",
      };
    }

    const validation = await validateExamPayload(body, instituteId, {
      currentExam: exam,
      requireMandatoryFields: false,
    });
    if (validation.error) {
      return validation;
    }

    const values = (validation as any).values;
    const nextExamType = values.examType ?? exam.examType;
    const nextSessionId = values.sessionId ?? exam.sessionId;
    const nextClassId =
      values.classId !== undefined ? values.classId : exam.classId;
    const nextSubjectId = values.subjectId ?? exam.subjectId;

    const duplicate = await Exam.findOne({
      where: {
        examId: { [Op.ne]: examId },
        instituteId,
        sessionId: nextSessionId,
        classId: nextClassId,
        subjectId: nextSubjectId,
        examType: nextExamType,
        isDeleted: false,
      },
    });

    if (duplicate) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message:
          "Another exam with the same session, class, subject, type, and date already exists.",
      };
    }

    await exam.update({
      sessionId: nextSessionId,
      classId: nextClassId,
      examType: nextExamType,
      subjectId: nextSubjectId,
      teacherId: values.teacherId ?? exam.teacherId,
      examinerId:
        values.examinerId !== undefined ? values.examinerId : exam.examinerId,
      totalMarks: values.totalMarks ?? exam.totalMarks,
      passingMarks: values.passingMarks ?? exam.passingMarks,
      duration: values.duration !== undefined ? values.duration : exam.duration,
      instructions:
        values.instructions !== undefined ? values.instructions : exam.instructions,
      status: values.status ?? exam.status,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam updated successfully.",
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
