import httpStatus from "http-status";
import Section from "../modals/Section.modal";
import Class from "../modals/Class.modal";
import User from "../modals/User.modal";
import RegHelper from "../utils/helper";

// ─── CREATE SECTION ───────────────────────────────────────────────────────────
const createSection = async (body: any, createdBy: any): Promise<any> => {
  try {
    if (!body.classId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "classId is required.",
      };
    }

    if (!body.sectionName) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sectionName is required.",
      };
    }

    const classData = await Class.findOne({
      where: {
        classId: body.classId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!classData) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Class not found.",
      };
    }

    const exists = await Section.findOne({
      where: {
        classId: body.classId,
         instituteId: createdBy.instituteId,
        sectionName: body.sectionName,
        isDeleted: false,
      },
    });

    if (exists) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Section already exists.",
      };
    }

    let teacher = null;

    if (body.classTeacherId) {
      teacher = await User.findOne({
        where: {
          userId: body.classTeacherId,
          instituteId: createdBy.instituteId,
          isDeleted: false,
        },
      });

      if (!teacher) {
        return {
          error: true,
          statusCode: httpStatus.NOT_FOUND,
          message: "Teacher not found.",
        };
      }
    }
    const sectionId = await RegHelper.generateUserId();

    const newSection = await Section.create({
      sectionId,
      classId: body.classId,
      instituteId: createdBy.instituteId,
      sectionName: body.sectionName,
      classTeacherId: body.classTeacherId || null,
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Section created successfully.",
      data: newSection,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: e.message,
    };
  }
};

// ─── GET ALL SECTIONS ─────────────────────────────────────────────────────────
const getAllSections = async (query: any, createdBy: any): Promise<any> => {
  try {
    const where: any = {
      instituteId: createdBy.instituteId,
      isDeleted: false,
      isActive: true,
    };

    if (query.classId) {
      where.classId = query.classId;
    }

    const sections = await Section.findAll({
      where,
      include: [
        {
          model: User,
          as: "classTeacher",
          attributes: ["userId", "userName", "emailId"],
          required: false,
        },
      ],
      order: [["sectionName", "ASC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Sections fetched successfully.",
      data: {
        sections,
        total: sections.length,
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

// ─── GET SECTION BY ID ────────────────────────────────────────────────────────
const getSectionById = async (
  sectionId: string,
  createdBy: any,
): Promise<any> => {
  try {
    const section = await Section.findOne({
      where: {
        sectionId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
      include: [
        {
          model: User,
          as: "classTeacher",
          attributes: ["userId", "userName", "emailId"],
          required: false,
        },
      ],
    });

    if (!section) {
      return {
        error: true,
        statusCode: 404,
        message: "Section not found.",
      };
    }

    return {
      error: false,
      statusCode: 200,
      message: "Section fetched successfully.",
      data: section,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: 500,
      message: e.message,
    };
  }
};

// ─── UPDATE SECTION ───────────────────────────────────────────────────────────
const updateSection = async (
  sectionId: string,
  body: any,
  createdBy: any,
): Promise<any> => {
  try {
    const hasSectionName = Object.prototype.hasOwnProperty.call(
      body,
      "sectionName",
    );
    const normalizedSectionName =
      typeof body.sectionName === "string" ? body.sectionName.trim() : undefined;

    const section = await Section.findOne({
      where: {
        sectionId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!section) {
      return {
        error: true,
        statusCode: 404,
        message: "Section not found.",
      };
    }

    if (hasSectionName && !normalizedSectionName) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sectionName cannot be empty.",
      };
    }

    if (normalizedSectionName) {
      const exists = await Section.findOne({
        where: {
          classId: section.classId,
          instituteId: createdBy.instituteId,
          sectionName: normalizedSectionName,
          isDeleted: false,
        },
      });

      if (exists && exists.sectionId !== sectionId) {
        return {
          error: true,
          statusCode: httpStatus.CONFLICT,
          message: "Section name already exists in this class.",
        };
      }
    }

    if (body.classTeacherId) {
      const teacher = await User.findOne({
        where: {
          userId: body.classTeacherId,
          instituteId: createdBy.instituteId,
          isDeleted: false,
        },
      });

      if (!teacher) {
        return {
          error: true,
          statusCode: httpStatus.NOT_FOUND,
          message: "Teacher not found.",
        };
      }
    }

    await section.update({
      sectionName:
        normalizedSectionName !== undefined
          ? normalizedSectionName
          : section.sectionName,

      classTeacherId:
        body.classTeacherId !== undefined
          ? body.classTeacherId
          : section.classTeacherId,
    });

    await section.reload({
      include: [
        {
          model: User,
          as: "classTeacher",
          attributes: ["userId", "userName", "emailId"],
          required: false,
        },
      ],
    });

    return {
      error: false,
      statusCode: 200,
      message: "Section updated successfully.",
      data: section,
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: 500,
      message: e.message,
    };
  }
};

// ─── DELETE SECTION ───────────────────────────────────────────────────────────
const deleteSection = async (
  sectionId: string,
  createdBy: any,
): Promise<any> => {
  try {
    const section = await Section.findOne({
      where: {
        sectionId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!section) {
      return {
        error: true,
        statusCode: 404,
        message: "Section not found.",
      };
    }

    await section.update({
      isDeleted: true,
      isActive: false,
    });

    return {
      error: false,
      statusCode: 200,
      message: "Section deleted successfully.",
      data: {},
    };
  } catch (e: any) {
    return {
      error: true,
      statusCode: 500,
      message: e.message,
    };
  }
};

export default {
  createSection,
  getAllSections,
  getSectionById,
  updateSection,
  deleteSection,
};
