import httpStatus from "http-status";
import Exam from "../modals/Exam.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import { Op } from "sequelize";

const getStudentDashboardOverview = async (studentId: string, instituteId: string) => {
  try {
    // Get upcoming exams in next 7 days for the student's class
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const upcomingExams = await Exam.count({
      where: {
        instituteId,
        isDeleted: false,
        status: "Live",
        createdAt: {
          [Op.lte]: sevenDaysFromNow,
        },
      },
    });

    // Get completed exams for this session
    const completedExams = await Exam.count({
      where: {
        instituteId,
        isDeleted: false,
        status: "Completed",
      },
    });

    // Get published results (evaluations with 'Success' status)
    const publishedResults = await AIEvaluation.count({
      where: {
        studentId,
        status: "Success",
      },
    });

    // Get pending rechecks (evaluations with 'Failed' status for this student)
    const pendingRechecks = await AIEvaluation.count({
      where: {
        studentId,
        status: "Failed",
      },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student dashboard overview fetched successfully.",
      data: {
        upcomingExams,
        completedExams,
        publishedResults,
        pendingRechecks,
      },
    };
  } catch (error: any) {
    console.error("getStudentDashboardOverview error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Something went wrong.",
    };
  }
};

export default {
  getStudentDashboardOverview,
};
