import httpStatus from "http-status";
import Class from "../modals/Class.modal";
import Subject from "../modals/Subject.modal";
import Exam from "../modals/Exam.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import { Op } from "sequelize";

const getTeacherDashboardOverview = async (teacherId: string, instituteId: string) => {
  try {
    // Get assigned classes (where teacher is class teacher)
    const assignedClasses = await Class.count({
      where: {
        classTeacherId: teacherId,
        instituteId,
        isDeleted: false,
      },
    });

    // Get assigned subjects
    const assignedSubjects = await Subject.count({
      where: {
        teacherId,
        instituteId,
        isDeleted: false,
      },
    });

    // Total classes (either as class teacher or subject teacher)
    const totalClasses = assignedClasses + assignedSubjects;

    // Get upcoming exams in next 7 days for this teacher
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    const upcomingExams = await Exam.count({
      where: {
        teacherId,
        instituteId,
        isDeleted: false,
        status: "Live",
        createdAt: {
          [Op.lte]: sevenDaysFromNow,
        },
      },
    });

    // Get pending evaluations (answer sheets with 'Pending' status for this teacher's exams)
    const teacherExamIds = await Exam.findAll({
      where: {
        teacherId,
        instituteId,
        isDeleted: false,
      },
      attributes: ["examId"],
    });

    const examIds = teacherExamIds.map((exam) => exam.examId);

    const pendingEvaluations = await AIEvaluation.count({
      where: {
        examId: {
          [Op.in]: examIds,
        },
        status: "Pending",
      },
    });

    // Get recheck requests (evaluations that need review - could be based on status or a recheck flag)
    // For now, let's count evaluations with 'Failed' status that might need recheck
    const recheckRequests = await AIEvaluation.count({
      where: {
        examId: {
          [Op.in]: examIds,
        },
        status: "Failed",
      },
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher dashboard overview fetched successfully.",
      data: {
        totalClasses,
        upcomingExams,
        pendingEvaluations,
        recheckRequests,
      },
    };
  } catch (error: any) {
    console.error("getTeacherDashboardOverview error:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Something went wrong.",
    };
  }
};

export default {
  getTeacherDashboardOverview,
};
