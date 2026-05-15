import httpStatus from "http-status";
import Subject from "../modals/Subject.modal";
import RegHelper from "../utils/helper";


// ─── CREATE SUBJECT ─────────────────────────────────────────────
const createSubject = async (
  body: any,
  createdBy: any
): Promise<any> => {
  try {

    if (!body.classId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "classId is required.",
      };
    }

    if (!body.sessionId) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "sessionId is required.",
      };
    }

    if (!body.subjectName) {
      return {
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "subjectName is required.",
      };
    }

    const instituteId = createdBy.instituteId;

    // Check duplicate
    const exists = await Subject.findOne({
      where: {
        instituteId,
        classId: body.classId,
        sectionId: body.sectionId || null,
        subjectName: body.subjectName,
        isDeleted: false,
      },
    });

    if (exists) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "Subject already exists.",
      };
    }

    const subjectId = await RegHelper.generateUserId();

    const newSubject = await Subject.create({
      subjectId,
      instituteId,
      sessionId: body.sessionId,
      classId: body.classId,
      sectionId: body.sectionId || null,
      subjectName: body.subjectName,
      subjectCode: body.subjectCode || null,
      teacherId: body.teacherId || null,
      totalMarks: body.totalMarks || 100,
      passingMarks: body.passingMarks || 35,
    });

    return {
      error: false,
      statusCode: httpStatus.CREATED,
      message: "Subject created successfully.",
      data: newSubject,
    };

  } catch (e: any) {

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: e.message,
    };

  }
};



// ─── GET ALL SUBJECTS ──────────────────────────────────────────
const getAllSubjects = async (
  query: any,
  createdBy: any
): Promise<any> => {

  try {

    const where: any = {
      instituteId: createdBy.instituteId,
      isDeleted: false,
      isActive: true,
    };

    if (query.classId) {
      where.classId = query.classId;
    }

    if (query.sectionId) {
      where.sectionId = query.sectionId;
    }

    const subjects = await Subject.findAll({
      where,
      order: [["subjectName", "ASC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subjects fetched successfully.",
      data: {
        subjects,
        total: subjects.length,
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



// ─── GET SUBJECT BY ID ─────────────────────────────────────────
const getSubjectById = async (
  subjectId: string,
  createdBy: any
): Promise<any> => {

  try {

    const subject = await Subject.findOne({
      where: {
        subjectId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!subject) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Subject not found.",
      };
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subject fetched successfully.",
      data: subject,
    };

  } catch (e: any) {

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: e.message,
    };

  }
};



// ─── UPDATE SUBJECT ────────────────────────────────────────────
const updateSubject = async (
  subjectId: string,
  body: any,
  createdBy: any
): Promise<any> => {

  try {

    const subject = await Subject.findOne({
      where: {
        subjectId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!subject) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Subject not found.",
      };
    }

    await subject.update({
      subjectName: body.subjectName ?? subject.subjectName,
      subjectCode: body.subjectCode ?? subject.subjectCode,
      teacherId: body.teacherId ?? subject.teacherId,
      totalMarks: body.totalMarks ?? subject.totalMarks,
      passingMarks: body.passingMarks ?? subject.passingMarks,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subject updated successfully.",
      data: subject,
    };

  } catch (e: any) {

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: e.message,
    };

  }
};



// ─── DELETE SUBJECT (SOFT DELETE) ─────────────────────────────
const deleteSubject = async (
  subjectId: string,
  createdBy: any
): Promise<any> => {

  try {

    const subject = await Subject.findOne({
      where: {
        subjectId,
        instituteId: createdBy.instituteId,
        isDeleted: false,
      },
    });

    if (!subject) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Subject not found.",
      };
    }

    await subject.update({
      isDeleted: true,
      isActive: false,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subject deleted successfully.",
      data: {},
    };

  } catch (e: any) {

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: e.message,
    };

  }
};


export default {
  createSubject,
  getAllSubjects,
  getSubjectById,
  updateSubject,
  deleteSubject,
};