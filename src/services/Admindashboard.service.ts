import httpStatus from "http-status";
import Student from "../modals/Student.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import Class from "../modals/Class.modal";
import Exam from "../modals/Exam.modal";
import Subject from "../modals/Subject.modal";
import ScannerProfile from "../modals/ScannerProfile.modal";

const getOverview = async (instituteId: string) => {
  try {
    const [
      totalStudents,
      totalTeachers,
      totalClasses,
      totalExams,
      totalSubjects,
      totalScanners
    ] = await Promise.all([
      Student.count({
        where: {
          instituteId,
        },
      }),
      TeacherProfile.count({
        where: {
          instituteId,
        },
      }),
      Class.count({
        where: {
          instituteId,
          isDeleted: false,
        },
      }),
      Exam.count({
        where: {
          instituteId,
          isDeleted: false,
        },
      }),
      Subject.count({
        where: {
          instituteId,
          isDeleted: false,
        },
      }),
      ScannerProfile.count({
        where: {
          instituteId,
        },
      }),
    ]);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Admin dashboard overview fetched successfully.",
      data: {
        totalStudents,
        totalTeachers,
        totalClasses,
        totalExams,
        totalSubjects,
        totalScanners,
      },
    };
  } catch (error: any) {
    console.error("getOverview error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Something went wrong.",
    };
  }
};

export default {
  getOverview,
};