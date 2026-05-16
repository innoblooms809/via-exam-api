import httpStatus from "http-status";
import Class from "../modals/Class.modal";
import RegHelper from "../utils/helper";
import Section from "../modals/Section.modal";
import Subject from "../modals/Subject.modal";

// ─── CREATE CLASS ─────────────────────────────────────────────────────────────
const createClass = async (body: any, createdBy: any): Promise<any> => {
  try {

    if (!body.className) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "className is required.",
      };
    }
    const instituteId = createdBy.instituteId;

    const exists = await Class.findOne({
      where: {
        instituteId,
        className: body.className,
        isDeleted: false,
      },
    });

    if (exists) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Class already exists",
      };
    }

    const classId = await RegHelper.generateUserId();

    const newClass = await Class.create({
      classId,
      instituteId,
      className: body.className,
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Class created successfully.",
      data: newClass,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: e.message,
    };
  }
};

// ─── GET ALL CLASSES ──────────────────────────────────────────────────────────
const getAllClasses = async (createdBy: any): Promise<any> => {
  try {
    const where: any = {
      instituteId: createdBy.instituteId,
      isActive: true,
      isDeleted: false,
    };

    const classes = await Class.findAll({
      where,
      include: [
        {
          model: Section,
          as: "sections",
        },
        {
          model: Subject,
          as: "subjects",
        },
      ],
      order: [["className", "ASC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Classes fetched successfully.",
      data: {
        classes,
        total: classes.length,
      },
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: 500,
      message: e.message,
    };
  }
};

// ─── GET ONE CLASS with students + exams ──────────────────────────────────────
const getClassById = async (classId: string, createdBy: any): Promise<any> => {
  try {
    const classData = await Class.findOne({
      where: {
        classId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
      include: [
        {
          model: Section,
          as: "sections",
        },
        {
          model: Subject,
          as: "subjects",
        },
      ],
    });

    if (!classData) {
      return {
        error: true,
        statusCode: 404,
        message: "Class not found.",
      };
    }

    return {
      error: false,
      statusCode: 200,
      message: "Class fetched successfully.",
      data: classData,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: 500,
      message: e.message,
    };
  }
};

// ─── UPDATE CLASS ─────────────────────────────────────────────────────────────
const updateClass = async (
  classId: string,
  body: any,
  createdBy: any,
): Promise<any> => {
  try {
    const classData = await Class.findOne({
      where: {
        classId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!classData) {
      return {
        error: true,
        statusCode: 404,
        message: "Class not found.",
      };
    }

    if (body.className) {
  const exists = await Class.findOne({
    where: {
      instituteId: createdBy.instituteId,
      className: body.className,
      isDeleted: false,
    },
  });

  if (exists && exists.classId !== classId) {
    return {
      error: true,
      statusCode: httpStatus.CONFLICT,
      message: "Class name already exists.",
    };
  }
}

    await classData.update({
      className: body.className ?? classData.className,
    });

    return {
      error: false,
      statusCode: 200,
      message: "Class updated successfully.",
      data: classData,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: 500,
      message: e.message,
    };
  }
};

// ─── DEACTIVATE CLASS ─────────────────────────────────────────────────────────
const deleteClass = async (classId: string, createdBy: any): Promise<any> => {
  try {
    const classData = await Class.findOne({
      where: { classId, instituteId: createdBy.instituteId, isDeleted: false },
    });

    if (!classData) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Class not found.",
      };
    }

    await classData.update({
      isDeleted: true,
      isActive: false,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Class deactivated successfully.",
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
  createClass,
  getAllClasses,
  getClassById,
  updateClass,
  deleteClass,
};
