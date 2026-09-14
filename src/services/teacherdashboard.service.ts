import httpStatus from "http-status";
import { Op } from "sequelize";
import Class from "../modals/Class.modal";
import Subject from "../modals/Subject.modal";
import Exam from "../modals/Exam.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import ActivityLog from "../modals/ActivityLog.modal";
import {
  DASHBOARD_COLORS,
  getMonthBuckets,
  countInBucket,
  percentValue,
  percentLabel,
  formatDate,
  formatCount,
  timeAgo,
  getExamStyle,
  getSubjectPerformanceStyle,
} from "../utils/adminDashboard.helper";

const errorResult = (message = "Something went wrong.") => ({
  error: true,
  statusCode: httpStatus.INTERNAL_SERVER_ERROR,
  message,
});

const getTeacherExamIds = async (teacherId: string, instituteId: string) => {
  const rows = await Exam.findAll({
    where: { teacherId, instituteId, isDeleted: false },
    attributes: ["examId", "status"],
    raw: true,
  });
  const examIds = rows.map((r: any) => r.examId);
  const examIdFilter = examIds.length ? { [Op.in]: examIds } : { [Op.in]: [""] };
  return { rows, examIds, examIdFilter };
};

// ─── OVERVIEW / KPIs ─────────────────────────────────────────────────────────
const getTeacherDashboardOverview = async (teacherId: string, instituteId: string) => {
  try {
    const { rows, examIdFilter } = await getTeacherExamIds(teacherId, instituteId);
    const examsCreated = rows.length;
    const resultsPublished = rows.filter((r: any) => r.status === "Completed").length;

    const [questionPapersCreated, answerSheetsEvaluated] = await Promise.all([
      QuestionPaper.count({ where: { instituteId, teacherId, examId: examIdFilter } }),
      AIEvaluation.count({ where: { examId: examIdFilter, status: "Success" } }),
    ]);

    const kpis = [
      { title: "Exams Created", value: formatCount(examsCreated), icon: "DescriptionOutlined", iconBg: "#e7f0ff", iconColor: "#3973c8" },
      { title: "Question Papers Created", value: formatCount(questionPapersCreated), icon: "AssignmentOutlined", iconBg: "#f0e9ff", iconColor: "#7e57c2" },
      { title: "Answer Sheets Evaluated", value: formatCount(answerSheetsEvaluated), icon: "FactCheckOutlined", iconBg: "#e3f7eb", iconColor: "#3c9a67" },
      { title: "Results Published", value: formatCount(resultsPublished), icon: "InsertChartOutlined", iconBg: "#fff0e8", iconColor: "#f07836" },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher dashboard overview fetched successfully.",
      data: { kpis },
    };
  } catch (error: any) {
    console.error("getTeacherDashboardOverview error:", error);
    return errorResult();
  }
};

// ─── UPCOMING EXAMS ──────────────────────────────────────────────────────────
const getUpcomingExams = async (teacherId: string, instituteId: string) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const exams = await Exam.findAll({
      where: { teacherId, instituteId, isDeleted: false, status: { [Op.in]: ["Live", "Draft"] }, examDate: { [Op.gte]: today } },
      include: [
        { model: Subject, as: "subject", attributes: ["subjectName"], required: false },
        { model: Class, as: "class", attributes: ["className"], required: false },
      ],
      order: [["examDate", "ASC"], ["examTime", "ASC"]],
      limit: 8,
    });

    const upcomingExams = exams.map((exam: any, index: number) => {
      const style = getExamStyle(index);
      const subjectName = exam.subject?.subjectName || "Subject";
      return {
        name: `${exam.examType} - ${subjectName}`,
        subject: subjectName,
        className: exam.class?.className || "-",
        date: formatDate(exam.examDate),
        time: exam.examTime || "-",
        status: exam.status === "Live" ? "Upcoming" : "Draft",
        color: style.chipColor,
        bg: style.chipBg,
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Upcoming exams fetched successfully.",
      data: { upcomingExams },
    };
  } catch (error: any) {
    console.error("getUpcomingExams error:", error);
    return errorResult();
  }
};

// ─── EXAM ACTIVITY (funnel) ──────────────────────────────────────────────────
const getExamActivity = async (teacherId: string, instituteId: string) => {
  try {
    const { rows, examIdFilter } = await getTeacherExamIds(teacherId, instituteId);
    const totalExams = rows.length || 1;

    const [papers, evaluations] = await Promise.all([
      QuestionPaper.findAll({ where: { instituteId, teacherId, examId: examIdFilter }, attributes: ["examId"], raw: true }),
      AIEvaluation.findAll({ where: { examId: examIdFilter, status: "Success" }, attributes: ["examId"], raw: true }),
    ]);

    const examsWithPaper = new Set(papers.map((p: any) => p.examId)).size;
    const examsWithSuccessEval = new Set(evaluations.map((e: any) => e.examId)).size;
    const completedExams = rows.filter((r: any) => r.status === "Completed").length;

    const progress = [
      { label: "Exams Created", value: rows.length ? 100 : 0, color: "#3973c8" },
      { label: "Question Papers Created", value: percentValue(examsWithPaper, totalExams), color: "#3e9a69" },
      { label: "Answer Sheets Evaluated", value: percentValue(examsWithSuccessEval, totalExams), color: "#8558bd" },
      { label: "Results Published", value: percentValue(completedExams, totalExams), color: "#f07832" },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam activity fetched successfully.",
      data: { progress },
    };
  } catch (error: any) {
    console.error("getExamActivity error:", error);
    return errorResult();
  }
};

// ─── ACTIVITY OVERVIEW (monthly line/bar charts) ─────────────────────────────
const getActivityOverview = async (teacherId: string, instituteId: string) => {
  try {
    const months = getMonthBuckets(6);
    const rangeStart = months[0].start;
    const { examIdFilter } = await getTeacherExamIds(teacherId, instituteId);

    const [papers, evaluations] = await Promise.all([
      QuestionPaper.findAll({ where: { instituteId, teacherId, createdAt: { [Op.gte]: rangeStart } }, attributes: ["createdAt"], raw: true }),
      AIEvaluation.findAll({ where: { examId: examIdFilter, createdAt: { [Op.gte]: rangeStart } }, attributes: ["createdAt", "status"], raw: true }),
    ]);

    const paperDates = papers.map((p: any) => new Date(p.createdAt));
    const evalDates = evaluations.map((e: any) => new Date(e.createdAt));
    const reportDates = evaluations.filter((e: any) => e.status === "Success").map((e: any) => new Date(e.createdAt));

    const activityData = months.map((bucket) => ({
      month: bucket.month,
      questionPapers: countInBucket(paperDates, bucket),
      answerSheets: countInBucket(evalDates, bucket),
      reports: countInBucket(reportDates, bucket),
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Activity overview fetched successfully.",
      data: { activityData },
    };
  } catch (error: any) {
    console.error("getActivityOverview error:", error);
    return errorResult();
  }
};

// ─── UPCOMING WORK ───────────────────────────────────────────────────────────
const getUpcomingWork = async (teacherId: string, instituteId: string) => {
  try {
    const { examIdFilter } = await getTeacherExamIds(teacherId, instituteId);

    const [evaluations, papers, liveExams] = await Promise.all([
      AIEvaluation.findAll({ where: { examId: examIdFilter }, attributes: ["status"], raw: true }),
      QuestionPaper.findAll({ where: { instituteId, teacherId }, attributes: ["status"], raw: true }),
      Exam.count({ where: { teacherId, instituteId, isDeleted: false, status: "Live" } }),
    ]);

    const totalEvaluations = evaluations.length;
    const successEvaluations = evaluations.filter((e: any) => e.status === "Success").length;
    const evaluationProgress = percentValue(successEvaluations, totalEvaluations || 1);

    const draftPapers = papers.filter((p: any) => p.status === "DRAFT").length;
    const paperProgress = papers.length
      ? percentValue(papers.filter((p: any) => ["APPROVED", "PUBLISHED"].includes(p.status)).length, papers.length)
      : 0;

    const upcomingWork = [
      { title: "Answer Sheet Evaluation", progress: evaluationProgress, color: "#3973c8" },
      { title: "Question Paper Drafts", progress: draftPapers ? Math.max(15, 100 - percentValue(draftPapers, papers.length || draftPapers)) : paperProgress, color: "#3e9a69" },
      { title: "Upcoming Exams Preparation", progress: liveExams ? Math.min(100, liveExams * 20) : 0, color: "#a8b1bf" },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Upcoming work fetched successfully.",
      data: { upcomingWork },
    };
  } catch (error: any) {
    console.error("getUpcomingWork error:", error);
    return errorResult();
  }
};

// ─── EVALUATION STATUS (donut) ───────────────────────────────────────────────
const getEvaluationStatus = async (teacherId: string, instituteId: string) => {
  try {
    const { examIdFilter } = await getTeacherExamIds(teacherId, instituteId);
    const evaluations = await AIEvaluation.findAll({ where: { examId: examIdFilter }, attributes: ["status"], raw: true });

    const total = evaluations.length;
    const success = evaluations.filter((e: any) => e.status === "Success").length;
    const pending = evaluations.filter((e: any) => e.status === "Pending").length;
    const failed = evaluations.filter((e: any) => e.status === "Failed").length;

    const segments = [
      { value: percentValue(success, total || 1), color: DASHBOARD_COLORS.GREEN, label: "Evaluated" },
      { value: percentValue(pending, total || 1), color: DASHBOARD_COLORS.AMBER, label: "Pending" },
      { value: percentValue(failed, total || 1), color: DASHBOARD_COLORS.RED, label: "Recheck" },
    ];
    const legend = [
      { color: DASHBOARD_COLORS.GREEN, label: "Evaluated", value: String(success), percent: percentLabel(success, total) },
      { color: DASHBOARD_COLORS.AMBER, label: "Pending", value: String(pending), percent: percentLabel(pending, total) },
      { color: DASHBOARD_COLORS.RED, label: "Recheck", value: String(failed), percent: percentLabel(failed, total) },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation status fetched successfully.",
      data: { center: String(total), centerLabel: "Total Answers", segments, legend },
    };
  } catch (error: any) {
    console.error("getEvaluationStatus error:", error);
    return errorResult();
  }
};

// ─── SUBJECT WORKLOAD (donut) ────────────────────────────────────────────────
const getSubjectWorkload = async (teacherId: string, instituteId: string) => {
  try {
    const { examIdFilter } = await getTeacherExamIds(teacherId, instituteId);
    const evaluations = await AIEvaluation.findAll({ where: { examId: examIdFilter }, attributes: ["subjectId"], raw: true });
    const total = evaluations.length;

    const countsBySubject = new Map<string, number>();
    evaluations.forEach((e: any) => countsBySubject.set(e.subjectId, (countsBySubject.get(e.subjectId) || 0) + 1));

    const subjectIds = [...countsBySubject.keys()];
    const subjects = subjectIds.length
      ? await Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds } }, attributes: ["subjectId", "subjectName"], raw: true })
      : [];
    const subjectMap = new Map(subjects.map((s: any) => [s.subjectId, s.subjectName]));

    const sortedSubjectIds = [...countsBySubject.entries()].sort((a, b) => b[1] - a[1]).map(([sid]) => sid);

    const segments = sortedSubjectIds.map((sid, index) => ({
      value: percentValue(countsBySubject.get(sid)!, total || 1),
      color: getSubjectPerformanceStyle(index).color,
      label: subjectMap.get(sid) || sid,
    }));
    const legend = sortedSubjectIds.map((sid, index) => ({
      color: getSubjectPerformanceStyle(index).color,
      label: subjectMap.get(sid) || sid,
      value: String(countsBySubject.get(sid)),
      percent: percentLabel(countsBySubject.get(sid)!, total),
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subject workload fetched successfully.",
      data: { center: String(total), centerLabel: "Evaluations", segments, legend },
    };
  } catch (error: any) {
    console.error("getSubjectWorkload error:", error);
    return errorResult();
  }
};

// ─── RECENT ACTIVITY ─────────────────────────────────────────────────────────
const getRecentActivity = async (teacherId: string, instituteId: string) => {
  try {
    const logs = await ActivityLog.findAll({
      where: { userId: teacherId, instituteId },
      order: [["createdAt", "DESC"]],
      limit: 6,
    });

    const activities = logs.map((log: any) => ({
      title: String(log.eventType || "Activity").replace(/_/g, " "),
      subtitle: log.entityType ? `${log.entityType}${log.entityId ? ` - ${log.entityId}` : ""}` : "Teacher activity",
      time: timeAgo(log.createdAt),
      color: log.status === "FAILED" ? DASHBOARD_COLORS.RED : DASHBOARD_COLORS.BLUE,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Recent activity fetched successfully.",
      data: { activities },
    };
  } catch (error: any) {
    console.error("getRecentActivity error:", error);
    return errorResult();
  }
};

export default {
  getTeacherDashboardOverview,
  getUpcomingExams,
  getExamActivity,
  getActivityOverview,
  getUpcomingWork,
  getEvaluationStatus,
  getSubjectWorkload,
  getRecentActivity,
};
