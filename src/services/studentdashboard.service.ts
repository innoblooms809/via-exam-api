import httpStatus from "http-status";
import Exam from "../modals/Exam.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import RecheckRequest from "../modals/RecheckRequest.modal";
import Subject from "../modals/Subject.modal";
import Class from "../modals/Class.modal";
import ActivityLog from "../modals/ActivityLog.modal";
import { Op, fn, col } from "sequelize";
import {
  percentValue,
  formatDate,
  timeAgo,
  MONTH_LABELS,
  getGradeFromPercentage,
  getSubjectPerformanceStyle,
} from "../utils/adminDashboard.helper";

const getStudentDashboardOverview = async (studentId: string, instituteId: string) => {
  try {
    // Get student's profile to determine their class and section
    const studentProfile = await StudentProfile.findOne({
      where: { userId: studentId, instituteId },
      attributes: ["classId", "sectionId", "instituteId"],
    });

    if (!studentProfile) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Student profile not found.",
      };
    }

    const { classId } = studentProfile;

    // Get upcoming exams for the student's class
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingExams = await Exam.count({
      where: {
        instituteId,
        classId,
        isDeleted: false,
        status: "Live",
        examDate: { [Op.gte]: today },
      },
    });

    // Get completed exams for the student - exams where student has successful evaluation
    const studentSuccessfulEvals = await AIEvaluation.findAll({
      where: {
        studentId,
        status: "Success",
      },
      attributes: ["examId"],
      group: ["examId"],
    });
    const completedExams = studentSuccessfulEvals.length;

    // Get published results (evaluations with 'Success' status for this student)
    const publishedResults = await AIEvaluation.count({
      where: {
        studentId,
        status: "Success",
      },
    });

    // Get pending rechecks - using RecheckRequest model
    const pendingRechecks = await RecheckRequest.count({
      where: {
        studentId,
        instituteId,
        status: { [Op.in]: ["Pending", "Under Review"] },
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

const getUpcomingExams = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const studentProfile = await StudentProfile.findOne({
      where: { userId: studentId, instituteId },
      attributes: ["classId"],
    });

    if (!studentProfile) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Student profile not found." };
    }

    const { classId } = studentProfile;
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
    const offset = (page - 1) * limit;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, rows } = await Exam.findAndCountAll({
      where: {
        instituteId,
        classId,
        isDeleted: false,
        status: "Live",
        examDate: { [Op.gte]: today },
      },
      include: [
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: true },
        { model: Class, as: "class", attributes: ["classId", "className"], required: true },
      ],
      order: [
        ["examDate", "ASC"],
        ["examTime", "ASC"],
      ],
      limit,
      offset,
    });

    const exams = rows.map((exam: any) => ({
      exam: `${exam.examType} - ${exam.subject?.subjectName || exam.subjectId}`,
      subject: exam.subject?.subjectName || exam.subjectId,
      className: exam.class?.className || exam.classId,
      date: exam.examDate ? exam.examDate.toISOString().split("T")[0] : null,
      time: exam.examTime || null,
      status: "Upcoming",
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Upcoming exams fetched successfully.",
      data: {
        exams,
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
      },
    };
  } catch (error: any) {
    console.error("getUpcomingExams error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

const getExamProgress = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const studentProfile = await StudentProfile.findOne({
      where: { userId: studentId, instituteId },
      attributes: ["classId"],
    });

    if (!studentProfile) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Student profile not found." };
    }

    const { classId } = studentProfile;
    const period = query.period || "month";

    let dateFilter: any = {};
    const now = new Date();
    if (period === "month") {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      dateFilter = { [Op.gte]: startOfMonth };
    } else if (period === "semester") {
      const startOfSemester = now.getMonth() < 6
        ? new Date(now.getFullYear(), 0, 1)
        : new Date(now.getFullYear(), 6, 1);
      dateFilter = { [Op.gte]: startOfSemester };
    } else if (period === "year") {
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      dateFilter = { [Op.gte]: startOfYear };
    }

    const totalAssigned = await Exam.count({
      where: { instituteId, classId, isDeleted: false, examDate: dateFilter },
    });

    const upcoming = await Exam.count({
      where: { instituteId, classId, isDeleted: false, status: "Live", examDate: { [Op.gte]: new Date() } },
    });

    const studentEvals = await AIEvaluation.findAll({
      where: { studentId, status: "Success", createdAt: dateFilter },
      attributes: ["examId"],
      group: ["examId"],
    });
    const completed = studentEvals.length;

    const published = await AIEvaluation.count({
      where: { studentId, status: "Success", createdAt: dateFilter },
    });

    const rechecks = await RecheckRequest.count({
      where: { studentId, instituteId, status: { [Op.in]: ["Pending", "Under Review"] }, createdAt: dateFilter },
    });

    const progress = [
      { label: "Upcoming Exams", value: percentValue(upcoming, totalAssigned), color: "#3564C7" },
      { label: "Completed Exams", value: percentValue(completed, totalAssigned), color: "#20A36A" },
      { label: "Results Published", value: percentValue(published, Math.max(completed, 1)), color: "#6C4CE6" },
      { label: "Recheck Requests", value: percentValue(rechecks, Math.max(published, 1)), color: "#F28A2B" },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam progress fetched successfully.",
      data: { progress },
    };
  } catch (error: any) {
    console.error("getExamProgress error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

const getPerformanceOverview = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const period = query.period || "sixMonths";
    const now = new Date();

    let startDate: Date;
    if (period === "semester") {
      startDate = now.getMonth() < 6
        ? new Date(now.getFullYear(), 0, 1)
        : new Date(now.getFullYear(), 6, 1);
    } else {
      startDate = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    }

    const evaluations = await AIEvaluation.findAll({
      where: {
        studentId,
        status: "Success",
        createdAt: { [Op.gte]: startDate },
      },
      attributes: [
        [fn("DATE_TRUNC", "month", col("createdAt")), "month"],
        [fn("AVG", col("totalScore")), "avgScore"],
      ],
      group: [fn("DATE_TRUNC", "month", col("createdAt"))],
      order: [[fn("DATE_TRUNC", "month", col("createdAt")), "ASC"]],
      raw: true,
    });

    const performance = evaluations.map((e: any) => {
      const date = new Date(e.month);
      return { month: MONTH_LABELS[date.getMonth()], score: Math.round(Number(e.avgScore) || 0) };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Performance overview fetched successfully.",
      data: { performance },
    };
  } catch (error: any) {
    console.error("getPerformanceOverview error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

const getSubjectComparison = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const studentProfile = await StudentProfile.findOne({
      where: { userId: studentId, instituteId },
      attributes: ["classId", "sectionId"],
    });

    if (!studentProfile) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Student profile not found." };
    }

    const { classId, sectionId } = studentProfile;
    const period = query.period || "semester";

    let dateFilter: any = {};
    const now = new Date();
    if (period === "year") {
      dateFilter = { [Op.gte]: new Date(now.getFullYear(), 0, 1) };
    } else {
      dateFilter = { [Op.gte]: now.getMonth() < 6 ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), 6, 1) };
    }

    const yourScores = await AIEvaluation.findAll({
      where: { studentId, status: "Success", createdAt: dateFilter },
      attributes: ["subjectId", [fn("AVG", col("totalScore")), "avgScore"]],
      group: ["subjectId"],
      raw: true,
    });

    const classmates = await StudentProfile.findAll({
      where: { instituteId, classId, sectionId, isActive: true, userId: { [Op.ne]: studentId } },
      attributes: ["userId"],
    });
    const classmateIds = classmates.map((s) => s.userId);

    const classAverages = await AIEvaluation.findAll({
      where: { studentId: { [Op.in]: classmateIds }, status: "Success", createdAt: dateFilter },
      attributes: ["subjectId", [fn("AVG", col("totalScore")), "avgScore"]],
      group: ["subjectId"],
      raw: true,
    });

    const subjectIds = [...new Set([...yourScores.map((s: any) => s.subjectId), ...classAverages.map((s: any) => s.subjectId)])];
    const subjects = await Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds } }, attributes: ["subjectId", "subjectName"] });
    const subjectMap = new Map(subjects.map((s) => [s.subjectId, s.subjectName]));

    const yourScoreMap = new Map(yourScores.map((s: any) => [s.subjectId, Math.round(Number(s.avgScore) || 0)]));
    const classAvgMap = new Map(classAverages.map((s: any) => [s.subjectId, Math.round(Number(s.avgScore) || 0)]));

    const comparison = subjectIds.map((subjectId) => ({
      subject: subjectMap.get(subjectId) || subjectId,
      yourScore: yourScoreMap.get(subjectId) || 0,
      classAverage: classAvgMap.get(subjectId) || 0,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subject comparison fetched successfully.",
      data: { comparison },
    };
  } catch (error: any) {
    console.error("getSubjectComparison error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

const getLatestResults = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
    const offset = (page - 1) * limit;

    const { count, rows } = await AIEvaluation.findAndCountAll({
      where: { studentId, status: "Success" },
      include: [
        { model: Exam, as: "exam", attributes: ["examId", "examType", "totalMarks"], required: false },
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: true },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const results = rows.map((evaluation: any) => {
      const totalMarks = evaluation.exam?.totalMarks || 100;
      const percentage = Math.round((Number(evaluation.totalScore) / totalMarks) * 100);
      const { grade, status } = getGradeFromPercentage(percentage);

      return {
        subject: evaluation.subject?.subjectName || evaluation.subjectId,
        exam: evaluation.exam?.examType || evaluation.examId,
        score: `${evaluation.totalScore}/${totalMarks}`,
        percentage: `${percentage}%`,
        grade,
        status,
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Latest results fetched successfully.",
      data: {
        results,
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
      },
    };
  } catch (error: any) {
    console.error("getLatestResults error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

const getSubjectPerformance = async (studentId: string, instituteId: string): Promise<any> => {
  try {
    const evaluations = await AIEvaluation.findAll({
      where: { studentId, status: "Success" },
      include: [{ model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: true }],
      raw: false,
    });

    const examIds = [...new Set(evaluations.map((e: any) => e.examId).filter(Boolean))];
    const exams = examIds.length
      ? await Exam.findAll({ where: { examId: { [Op.in]: examIds } }, attributes: ["examId", "totalMarks"], raw: true })
      : [];
    const examTotalMarksMap = new Map(exams.map((e: any) => [e.examId, e.totalMarks]));

    const subjectMap = new Map<string, { scores: number[]; totalMarks: number; subjectName: string }>();

    for (const evaluation of evaluations) {
      const sid = evaluation.subjectId;
      const totalMarks = examTotalMarksMap.get(evaluation.examId) || 100;
      if (!subjectMap.has(sid)) {
        subjectMap.set(sid, { scores: [], totalMarks, subjectName: evaluation.subject?.subjectName || sid });
      }
      subjectMap.get(sid)!.scores.push(Number(evaluation.totalScore));
    }

    const performance = Array.from(subjectMap.entries()).map(([subjectId, data], index) => {
      const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      const percentage = Math.round((avgScore / data.totalMarks) * 100);
      const { grade } = getGradeFromPercentage(percentage);

      return {
        subject: data.subjectName,
        percentage,
        grade,
        ...getSubjectPerformanceStyle(index),
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subject performance fetched successfully.",
      data: { performance },
    };
  } catch (error: any) {
    console.error("getSubjectPerformance error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

const STUDENT_ACTIVITY_STYLE: Record<string, { icon: string; color: string; bg: string }> = {
  RESULT_PUBLISHED: { icon: "Assessment", color: "#EC4D74", bg: "#FFF0F4" },
  EXAM_SCHEDULE_UPDATED: { icon: "AssignmentTurnedIn", color: "#22A06B", bg: "#EAF9F1" },
  EXAM_SCHEDULED: { icon: "AssignmentTurnedIn", color: "#22A06B", bg: "#EAF9F1" },
  RECHECK_SUBMITTED: { icon: "RateReview", color: "#F46A4D", bg: "#FFF1ED" },
  RECHECK_COMPLETED: { icon: "RateReview", color: "#F46A4D", bg: "#FFF1ED" },
  EXAM_ANNOUNCED: { icon: "Campaign", color: "#F2A900", bg: "#FFF7E5" },
};
const DEFAULT_STUDENT_ACTIVITY_STYLE = { icon: "Assessment", color: "#3564C7", bg: "#EAF2FF" };

const getRecentActivity = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(query.limit || "10", 10)));

    const activities = await ActivityLog.findAll({
      where: { userId: studentId, instituteId },
      order: [["createdAt", "DESC"]],
      limit,
    });

    const formatted = activities.map((a: any) => {
      const style = STUDENT_ACTIVITY_STYLE[a.eventType] || DEFAULT_STUDENT_ACTIVITY_STYLE;
      return {
        title: a.metadata?.title || String(a.eventType || "Activity").replace(/_/g, " "),
        description: a.metadata?.description || `${a.entityType || "Activity"} ${a.entityId || ""} - ${a.status}`.trim(),
        time: timeAgo(a.createdAt),
        ...style,
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Recent activity fetched successfully.",
      data: { activities: formatted },
    };
  } catch (error: any) {
    console.error("getRecentActivity error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

const getRecheckRequests = async (studentId: string, instituteId: string, query: any): Promise<any> => {
  try {
    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
    const offset = (page - 1) * limit;

    const { count, rows } = await RecheckRequest.findAndCountAll({
      where: { studentId, instituteId },
      include: [
        { model: Exam, as: "exam", attributes: ["examId", "examType"], required: false },
        { model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false },
      ],
      order: [["createdAt", "DESC"]],
      limit,
      offset,
    });

    const requests = rows.map((req: any) => ({
      requestId: req.requestId,
      subject: req.subject?.subjectName || req.subjectId,
      exam: req.exam?.examType || req.examId,
      requestDate: formatDate(req.createdAt),
      completion: req.completedAt ? formatDate(req.completedAt) : null,
      status: req.status,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Recheck requests fetched successfully.",
      data: {
        requests,
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
      },
    };
  } catch (error: any) {
    console.error("getRecheckRequests error:", error);
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Something went wrong." };
  }
};

export default {
  getStudentDashboardOverview,
  getUpcomingExams,
  getExamProgress,
  getPerformanceOverview,
  getSubjectComparison,
  getLatestResults,
  getSubjectPerformance,
  getRecentActivity,
  getRecheckRequests,
};
