import httpStatus from "http-status";
import Class from "../modals/Class.modal";
import RegHelper from "../utils/helper";
import Section from "../modals/Section.modal";
import Subject from "../modals/Subject.modal";

// ─── CREATE CLASS ─────────────────────────────────────────────────────────────
const createClass = async (body: any, createdBy: any): Promise<any> => {
  try {

    const className = body.className?.trim();
    if (!className) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "className is required.",
      };
    }
    const instituteId = createdBy.instituteId;

    const exists: any = await Class.findOne({
      where: {
        instituteId,
        className,
      },
    });

    if (exists) {
      if (!exists.isDeleted) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "Class already exists",
        };
      } else {
        // Restore the soft-deleted class
        await exists.update({
          isDeleted: false,
          isActive: true,
        });

        return {
          error: false,
          statusCode: httpStatus.OK, // or CREATED, returning OK as it was restored
          message: "Class restored successfully.",
          data: exists,
        };
      }
    }

    const classId = await RegHelper.generateUserId();

    const newClass = await Class.create({
      classId,
      instituteId,
      className,
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Class created successfully.",
      data: newClass,
    };
  } catch (e: any) {
    console.error("POST /v1/class/createClass 500 - Error in service:", e);
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
          where: { isDeleted: false },
          required: false,
        },
        {
          model: Subject,
          as: "subjects",
          where: { isDeleted: false },
          required: false,
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
          where: { isDeleted: false },
          required: false,
        },
        {
          model: Subject,
          as: "subjects",
          where: { isDeleted: false },
          required: false,
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

    const className = body.className?.trim();
    if (className) {
      const exists: any = await Class.findOne({
        where: {
          instituteId: createdBy.instituteId,
          className,
        },
      });

      if (exists && exists.classId !== classId) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: exists.isDeleted
            ? "A deleted class with this name already exists. Please restore it or use a different name."
            : "Class name already exists.",
        };
      }
    }

    await classData.update({
      className: className ?? classData.className,
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
