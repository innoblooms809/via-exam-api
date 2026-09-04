import httpStatus from "http-status";
import Institute from "../modals/Institute.modal";
import Student from "../modals/Student.modal";
import Exam from "../modals/Exam.modal";
import Scanner from "../modals/Scanner.modal";

const getInstituteStats = async (): Promise<any> => {
  try {
    const totalInstitutes = await Institute.count({
      where: {
        isDeleted: false,
      },
    });

    const activeInstitutes = await Institute.count({
      where: {
        isDeleted: false,
        status: 1,
      },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Institute statistics fetched successfully.",
      data: {
        totalInstitutes,
        activeInstitutes,
      },
    };
  } catch (e: any) {
    console.error("getInstituteStats error:", e);

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const getStudentStats = async (): Promise<any> => {
  try {
    const totalStudents = await Student.count();

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student statistics fetched successfully.",
      data: {
        totalStudents,
      },
    };
  } catch (e: any) {
    console.error("getStudentStats error:", e);

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const getExamStats = async (): Promise<any> => {
  try {
    const totalExams = await Exam.count({
      where: {
        isDeleted: false,
      },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam statistics fetched successfully.",
      data: {
        totalExams,
      },
    };
  } catch (e: any) {
    console.error("getExamStats error:", e);

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

const getEvaluatedAnswersheetStats = async (): Promise<any> => {
  try {
    const evaluatedSheets = await Scanner.count({
      where: {
        isDeleted: false,
        status: "Evaluated",
      },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluated answer sheets statistics fetched successfully.",
      data: {
        evaluatedAnswersheets: evaluatedSheets,
      },
    };
  } catch (e: any) {
    console.error("getEvaluatedAnswersheetStats error:", e);

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${e.message}`,
    };
  }
};

export default {
  getInstituteStats,
  getStudentStats,
  getExamStats,
  getEvaluatedAnswersheetStats,
};