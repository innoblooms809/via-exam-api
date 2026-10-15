import httpStatus from "http-status";
import Exam from "../../models/Exam.model";
import StudentResult, { RESULT_STATUS } from "../../models/StudentResult.model";
import StudentEnrollment from "../../models/StudentEnrollment.model";
import { currentEnrollment } from "./enrollment.service";
import RecheckRequest from "../../models/RecheckRequest.model";
import Subject from "../../models/Subject.model";
import Class from "../../models/Class.model";
import ActivityLog from "../../models/ActivityLog.model";
import { Op, fn, col } from "sequelize";
import {
  percentValue,
  formatDate,
  timeAgo,
  MONTH_LABELS,
  getGradeFromPercentage,
  getSubjectPerformanceStyle,
} from "../../utils/adminDashboard.helper";

/**
 * Where the student studies now (their current session's class and section) and the
 * exams that are theirs: that session, that class, whole-class or their section.
 */
const placeOf = async (studentId: string, instituteId: string) => {
  const e = await currentEnrollment(studentId, instituteId);
  if (!e) return null;
  const exams = {
    instituteId,
    isDeleted: false,
    sessionId: e.sessionId,
    classId: e.classId,
    [Op.or]: [{ sectionId: null }, { sectionId: "" }, ...(e.sectionId ? [{ sectionId: e.sectionId }] : [])],
  };
  return { enrollment: e, exams };
};

const NO_PROFILE = { error: true, statusCode: httpStatus.NOT_FOUND, message: "Student profile not found." };

const getStudentDashboardOverview = async (studentId: string, instituteId: string) => {
  try {
    const place = await placeOf(studentId, instituteId);
    if (!place) return NO_PROFILE;

    // Upcoming exams of the student's class this session
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const upcomingExams = await Exam.count({
      where: { ...place.exams, status: "Live", examDate: { [Op.gte]: today } },
    });

    // Students only ever see results the admin has published.
    const [completedExams, publishedResults] = await Promise.all([
      StudentResult.count({
        where: { studentId, instituteId, isDeleted: false, resultStatus: { [Op.ne]: RESULT_STATUS.ABSENT } },
      }),
      StudentResult.count({ where: { studentId, instituteId, isDeleted: false } }),
    ]);

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
    const place = await placeOf(studentId, instituteId);
    if (!place) return NO_PROFILE;

    const page = Math.max(1, parseInt(query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || "10", 10)));
    const offset = (page - 1) * limit;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { count, rows } = await Exam.findAndCountAll({
      where: { ...place.exams, status: "Live", examDate: { [Op.gte]: today } },
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
    const place = await placeOf(studentId, instituteId);
    if (!place) return NO_PROFILE;

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
      where: { ...place.exams, examDate: dateFilter },
    });

    const upcoming = await Exam.count({
      where: { ...place.exams, status: "Live", examDate: { [Op.gte]: new Date() } },
    });

    const [completed, published] = await Promise.all([
      StudentResult.count({
        where: { studentId, instituteId, isDeleted: false, resultStatus: { [Op.ne]: RESULT_STATUS.ABSENT }, publishedAt: dateFilter },
      }),
      StudentResult.count({ where: { studentId, instituteId, isDeleted: false, publishedAt: dateFilter } }),
    ]);

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

    // Monthly average percentage of published results (marks out of different
    // totals can't be averaged directly).
    const evaluations = await StudentResult.findAll({
      where: {
        studentId,
        instituteId,
        isDeleted: false,
        percentage: { [Op.ne]: null },
        publishedAt: { [Op.gte]: startDate },
      },
      attributes: [
        [fn("DATE_TRUNC", "month", col("publishedAt")), "month"],
        [fn("AVG", col("percentage")), "avgScore"],
      ],
      group: [fn("DATE_TRUNC", "month", col("publishedAt"))],
      order: [[fn("DATE_TRUNC", "month", col("publishedAt")), "ASC"]],
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
    const place = await placeOf(studentId, instituteId);
    if (!place) return NO_PROFILE;
    const { sessionId, classId, sectionId } = place.enrollment;
    const period = query.period || "semester";

    let dateFilter: any = {};
    const now = new Date();
    if (period === "year") {
      dateFilter = { [Op.gte]: new Date(now.getFullYear(), 0, 1) };
    } else {
      dateFilter = { [Op.gte]: now.getMonth() < 6 ? new Date(now.getFullYear(), 0, 1) : new Date(now.getFullYear(), 6, 1) };
    }

    // Published results only, compared as percentages.
    const yourScores = await StudentResult.findAll({
      where: { studentId, instituteId, isDeleted: false, percentage: { [Op.ne]: null }, publishedAt: dateFilter },
      attributes: ["subjectId", [fn("AVG", col("percentage")), "avgScore"]],
      group: ["subjectId"],
      raw: true,
    });

    const classmates = await StudentEnrollment.findAll({
      where: { instituteId, sessionId, classId, sectionId, isActive: true, studentId: { [Op.ne]: studentId } },
      attributes: ["studentId"],
    });
    const classmateIds = classmates.map((s) => s.studentId);

    const classAverages = classmateIds.length
      ? await StudentResult.findAll({
          where: { studentId: { [Op.in]: classmateIds }, instituteId, isDeleted: false, percentage: { [Op.ne]: null }, publishedAt: dateFilter },
          attributes: ["subjectId", [fn("AVG", col("percentage")), "avgScore"]],
          group: ["subjectId"],
          raw: true,
        })
      : [];

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

    const { count, rows } = await StudentResult.findAndCountAll({
      where: { studentId, instituteId, isDeleted: false },
      include: [{ model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false }],
      order: [["publishedAt", "DESC"]],
      limit,
      offset,
    });

    const results = rows.map((result: any) => {
      const absent = result.resultStatus === RESULT_STATUS.ABSENT;
      const percentage = result.percentage == null ? null : Math.round(Number(result.percentage));
      return {
        subject: result.subject?.subjectName || result.subjectId,
        exam: result.examType,
        score: absent ? "Absent" : `${Number(result.marksObtained ?? 0)}/${result.totalMarks}`,
        percentage: percentage == null ? "—" : `${percentage}%`,
        grade: result.grade ?? "—",
        status: absent ? "Absent" : result.resultStatus === RESULT_STATUS.PASS ? "Passed" : "Failed",
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
    const results: any[] = await StudentResult.findAll({
      where: { studentId, instituteId, isDeleted: false, percentage: { [Op.ne]: null } },
      include: [{ model: Subject, as: "subject", attributes: ["subjectId", "subjectName"], required: false }],
    });

    const subjectMap = new Map<string, { percentages: number[]; subjectName: string }>();
    for (const result of results) {
      const sid = result.subjectId;
      if (!subjectMap.has(sid)) subjectMap.set(sid, { percentages: [], subjectName: result.subject?.subjectName || sid });
      subjectMap.get(sid)!.percentages.push(Number(result.percentage));
    }

    const performance = Array.from(subjectMap.entries()).map(([, data], index) => {
      const percentage = Math.round(data.percentages.reduce((a, b) => a + b, 0) / data.percentages.length);
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
