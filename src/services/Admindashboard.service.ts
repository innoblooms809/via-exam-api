import httpStatus from "http-status";
import { Op } from "sequelize";
import Student from "../modals/Student.modal";
import TeacherProfile from "../modals/TeacherProfile.modal";
import Class from "../modals/Class.modal";
import Exam from "../modals/Exam.modal";
import Subject from "../modals/Subject.modal";
import ScannerProfile from "../modals/ScannerProfile.modal";
import Scanner from "../modals/Scanner.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import AIEvaluation from "../modals/AIEvaluation.modal";
import User from "../modals/User.modal";
import Institute from "../modals/Institute.modal";
import ActivityLog from "../modals/ActivityLog.modal";
import {
  DASHBOARD_COLORS,
  TEACHER_QUICK_ACTIONS,
  countInBucket,
  formatCount,
  formatDate,
  formatInrShort,
  getExamStyle,
  getMonthBuckets,
  getPlanMonthlyRevenue,
  getRoleColor,
  getSubjectIcon,
  getTrend,
  getYearMonthBuckets,
  mapExamUiStatus,
  mapSheetStatus,
  percentLabel,
  percentValue,
  timeAgo,
  toLakhs,
} from "../utils/adminDashboard.helper";

const errorResult = (message = "Something went wrong.") => ({
  error: true,
  statusCode: httpStatus.INTERNAL_SERVER_ERROR,
  message,
});

const getOverview = async (instituteId: string) => {
  try {
    const [
      totalStudents,
      totalTeachers,
      totalClasses,
      totalExams,
      totalSubjects,
      totalScanners,
    ] = await Promise.all([
      Student.count({ where: { instituteId } }),
      TeacherProfile.count({ where: { instituteId } }),
      Class.count({ where: { instituteId, isDeleted: false } }),
      Exam.count({ where: { instituteId, isDeleted: false } }),
      Subject.count({ where: { instituteId, isDeleted: false } }),
      ScannerProfile.count({ where: { instituteId } }),
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
    return errorResult();
  }
};

const getTeacherAnalytics = async (instituteId: string) => {
  try {
    const months = getMonthBuckets(6);
    const rangeStart = months[0].start;

    const instituteExams = await Exam.findAll({
      where: { instituteId, isDeleted: false },
      attributes: ["examId"],
      raw: true,
    });
    const examIds = instituteExams.map((exam: any) => exam.examId);
    const evaluationWhere = examIds.length ? { examId: { [Op.in]: examIds } } : { examId: { [Op.in]: [""] } };

    const [
      papers,
      sheets,
      evaluations,
      teachers,
      upcomingExamRows,
      totalStudents,
      activeStudents,
      pendingEvaluations,
      successfulReports,
      recentLogs,
      draftPapers,
      liveExams,
    ] = await Promise.all([
      QuestionPaper.findAll({
        where: { instituteId, createdAt: { [Op.gte]: rangeStart } },
        attributes: ["createdAt", "status", "examId"],
        raw: true,
      }),
      Scanner.findAll({
        where: { instituteId, isDeleted: false, createdAt: { [Op.gte]: rangeStart } },
        attributes: ["createdAt", "status"],
        raw: true,
      }),
      AIEvaluation.findAll({
        where: { ...evaluationWhere, createdAt: { [Op.gte]: rangeStart } },
        attributes: ["createdAt", "status", "examId", "subjectId", "examType"],
        raw: true,
      }),
      TeacherProfile.findAll({
        where: { instituteId },
        attributes: ["teacherType", "userId"],
        raw: true,
      }),
      Exam.findAll({
        where: {
          instituteId,
          isDeleted: false,
          status: { [Op.in]: ["Live", "Draft"] },
        },
        include: [
          { model: Subject, as: "subject", attributes: ["subjectName"], required: false },
          { model: Class, as: "class", attributes: ["className"], required: false },
          { model: User, as: "teacher", attributes: ["userName"], required: false },
        ],
        order: [["createdAt", "DESC"]],
        limit: 6,
      }),
      Student.count({ where: { instituteId } }),
      Student.count({ where: { instituteId, isActive: true } }),
      AIEvaluation.count({
        where: { ...evaluationWhere, status: { [Op.in]: ["Pending", "Processing"] } },
      }),
      AIEvaluation.count({
        where: { ...evaluationWhere, status: { [Op.in]: ["Success", "Evaluated"] } },
      }),
      ActivityLog.findAll({
        where: {
          instituteId,
          role: { [Op.iLike]: "%teacher%" },
        },
        order: [["createdAt", "DESC"]],
        limit: 6,
      }).catch(() => []),
      QuestionPaper.count({
        where: { instituteId, status: { [Op.in]: ["DRAFT", "PENDING_APPROVAL"] } },
      }),
      Exam.count({
        where: { instituteId, isDeleted: false, status: "Live" },
      }),
    ]);

    const paperDates = papers.map((row: any) => new Date(row.createdAt));
    const sheetDates = sheets.map((row: any) => new Date(row.createdAt));
    const reportDates = (evaluations as any[])
      .filter((row) => ["Success", "Evaluated"].includes(String(row.status)))
      .map((row) => new Date(row.createdAt));

    const activityData = months.map((bucket) => ({
      month: bucket.month,
      questionPapers: countInBucket(paperDates, bucket),
      answerSheets: countInBucket(sheetDates, bucket),
      reports: countInBucket(reportDates, bucket),
    }));

    const roleCounts = teachers.reduce((acc: Record<string, number>, teacher: any) => {
      const key = teacher.teacherType || "Teacher";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    const roleData = Object.entries(roleCounts).map(([name, value], index) => ({
      name,
      value,
      color: getRoleColor(name, index),
    }));

    const upcomingExams = upcomingExamRows.map((exam: any, index: number) => {
      const style = getExamStyle(index);
      const subjectName = exam.subject?.subjectName || "Subject";
      return {
        id: exam.id,
        subject: subjectName,
        className: exam.class?.className || "-",
        teacher: exam.teacher?.userName || "-",
        date: formatDate(exam.createdAt),
        status: exam.status === "Live" ? "Upcoming" : exam.status,
        ...style,
        icon: getSubjectIcon(subjectName),
      };
    });

    const attendance = percentValue(activeStudents, totalStudents);
    const kpiData = [
      {
        title: "Total Students",
        value: formatCount(totalStudents),
        icon: "Groups",
        bg: "#eff6ff",
        color: "#2563eb",
      },
      {
        title: "Attendance",
        value: `${attendance}%`,
        icon: "EventAvailable",
        bg: "#f0fdf4",
        color: "#16a34a",
      },
      {
        title: "Tasks Pending",
        value: formatCount(pendingEvaluations),
        icon: "TaskAlt",
        bg: "#fff7ed",
        color: "#3D5CE5",
      },
      {
        title: "Reports Generated",
        value: formatCount(successfulReports),
        icon: "Analytics",
        bg: "#f3e8ff",
        color: "#9333ea",
      },
    ];

    const activities = (recentLogs as any[]).slice(0, 6).map((log) => ({
      title: String(log.eventType || "Activity").replace(/_/g, " "),
      subtitle: log.entityType ? `${log.entityType}${log.entityId ? ` - ${log.entityId}` : ""}` : "Teacher activity",
      time: timeAgo(log.createdAt),
      color: log.status === "FAILED" ? DASHBOARD_COLORS.RED : DASHBOARD_COLORS.BLUE,
    }));

    const totalSheets = sheets.length;
    const processedSheets = sheets.filter((row: any) => mapSheetStatus(row.status) === "Processed").length;
    const evaluationProgress = percentValue(processedSheets, totalSheets || 1);
    const paperProgress = papers.length
      ? percentValue(
          papers.filter((row: any) => ["APPROVED", "PUBLISHED"].includes(row.status)).length,
          papers.length
        )
      : 0;

    const upcomingWork = [
      {
        title: "Answer Sheet Evaluation",
        progress: evaluationProgress,
        color: "#2563eb",
      },
      {
        title: "Question Paper Drafts",
        progress: draftPapers ? Math.max(15, 100 - percentValue(draftPapers, papers.length || draftPapers)) : paperProgress,
        color: "#16a34a",
      },
      {
        title: "Live Exams In Progress",
        progress: liveExams ? Math.min(100, liveExams * 20) : 0,
        color: "#9333ea",
      },
    ];

    const questionPaperCount = papers.length;
    const evaluationCount = (evaluations as any[]).length;
    const reportCount = reportDates.length;
    const recheckCount = (evaluations as any[]).filter((row) => String(row.status) === "Failed").length;
    const activityMax = Math.max(questionPaperCount, evaluationCount, reportCount, recheckCount, 1);

    const examActivity = [
      {
        label: "Question Papers",
        value: questionPaperCount,
        percentage: percentValue(questionPaperCount, activityMax),
        color: DASHBOARD_COLORS.BLUE,
      },
      {
        label: "Evaluations",
        value: evaluationCount,
        percentage: percentValue(evaluationCount, activityMax),
        color: DASHBOARD_COLORS.GREEN,
      },
      {
        label: "Reports",
        value: reportCount,
        percentage: percentValue(reportCount, activityMax),
        color: DASHBOARD_COLORS.INDIGO,
      },
      {
        label: "Rechecks",
        value: recheckCount,
        percentage: percentValue(recheckCount, activityMax),
        color: DASHBOARD_COLORS.CYAN,
      },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Teacher analytics fetched successfully.",
      data: {
        activityData,
        roleData,
        upcomingExams,
        kpiData,
        quickActions: TEACHER_QUICK_ACTIONS,
        activities,
        upcomingWork,
        examActivity,
      },
    };
  } catch (error: any) {
    console.error("getTeacherAnalytics error:", error);
    return errorResult();
  }
};

const getScannerAnalytics = async (instituteId: string) => {
  try {
    const months = getMonthBuckets(6);
    const rangeStart = months[0].start;

    const sheets = await Scanner.findAll({
      where: { instituteId, isDeleted: false },
      attributes: [
        "sheetId",
        "status",
        "createdAt",
        "uploadedBy",
        "classId",
        "subjectId",
        "examType",
      ],
      order: [["createdAt", "DESC"]],
    });

    const subjectIds = [...new Set(sheets.map((row) => row.subjectId).filter(Boolean))];
    const classIds = [...new Set(sheets.map((row) => row.classId).filter(Boolean))];
    const uploaderIds = [...new Set(sheets.map((row) => row.uploadedBy).filter(Boolean))];

    const [subjects, classes, uploaders] = await Promise.all([
      subjectIds.length
        ? Subject.findAll({
            where: { subjectId: { [Op.in]: subjectIds } },
            attributes: ["subjectId", "subjectName"],
          })
        : [],
      classIds.length
        ? Class.findAll({
            where: { classId: { [Op.in]: classIds } },
            attributes: ["classId", "className"],
          })
        : [],
      uploaderIds.length
        ? User.findAll({
            where: { userId: { [Op.in]: uploaderIds } },
            attributes: ["userId", "userName"],
          })
        : [],
    ]);

    const subjectMap = Object.fromEntries(subjects.map((row: any) => [row.subjectId, row.subjectName]));
    const classMap = Object.fromEntries(classes.map((row: any) => [row.classId, row.className]));
    const userMap = Object.fromEntries(uploaders.map((row: any) => [row.userId, row.userName]));

    const monthlySheets = sheets.filter((row) => row.createdAt >= rangeStart);
    const activityData = months.map((bucket) => {
      const bucketSheets = monthlySheets.filter(
        (row) => row.createdAt >= bucket.start && row.createdAt < bucket.end
      );
      const processed = bucketSheets.filter((row) => mapSheetStatus(row.status) === "Processed").length;
      const pending = bucketSheets.filter((row) => mapSheetStatus(row.status) === "Pending").length;
      const failed = bucketSheets.filter((row) => mapSheetStatus(row.status) === "Failed").length;
      return {
        month: bucket.month,
        sheets: bucketSheets.length,
        processed,
        pending,
        failed,
      };
    });

    const processed = sheets.filter((row) => mapSheetStatus(row.status) === "Processed").length;
    const pending = sheets.filter((row) => mapSheetStatus(row.status) === "Pending").length;
    const failed = sheets.filter((row) => mapSheetStatus(row.status) === "Failed").length;
    const total = sheets.length;

    const statusData = [
      {
        name: "Processed",
        value: processed,
        percentage: percentLabel(processed, total),
        color: DASHBOARD_COLORS.GREEN,
      },
      {
        name: "Pending",
        value: pending,
        percentage: percentLabel(pending, total),
        color: DASHBOARD_COLORS.AMBER,
      },
      {
        name: "Failed",
        value: failed,
        percentage: percentLabel(failed, total),
        color: DASHBOARD_COLORS.RED,
      },
    ];

    const recentScans = sheets.slice(0, 6).map((row) => {
      const mappedStatus = mapSheetStatus(row.status);
      const subjectName = subjectMap[row.subjectId] || row.examType || "Subject";
      const style =
        mappedStatus === "Processed"
          ? { iconBg: "#EAFBF3", iconColor: DASHBOARD_COLORS.GREEN }
          : mappedStatus === "Failed"
            ? { iconBg: "#FEF2F2", iconColor: DASHBOARD_COLORS.RED }
            : { iconBg: "#F1ECFF", iconColor: DASHBOARD_COLORS.INDIGO };
      return {
        id: row.sheetId,
        subject: subjectName,
        className: classMap[row.classId] || "-",
        sheets: "1 sheet",
        scanner: userMap[row.uploadedBy] || "Scanner",
        date: formatDate(row.createdAt),
        status: mappedStatus,
        icon: getSubjectIcon(subjectName),
        ...style,
      };
    });

    const progressData = [
      {
        label: "Sheets Scanned",
        value: total,
        percentage: total ? 100 : 0,
        color: DASHBOARD_COLORS.BLUE,
      },
      {
        label: "Processed",
        value: processed,
        percentage: percentValue(processed, total),
        color: DASHBOARD_COLORS.GREEN,
      },
      {
        label: "Pending",
        value: pending,
        percentage: percentValue(pending, total),
        color: DASHBOARD_COLORS.AMBER,
      },
      {
        label: "Failed / Recheck",
        value: failed,
        percentage: percentValue(failed, total),
        color: DASHBOARD_COLORS.RED,
      },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scanner analytics fetched successfully.",
      data: {
        activityData,
        statusData,
        recentScans,
        progressData,
      },
    };
  } catch (error: any) {
    console.error("getScannerAnalytics error:", error);
    return errorResult();
  }
};

const getStudentAnalytics = async (instituteId: string) => {
  try {
    const months = getMonthBuckets(6);

    const [exams, students] = await Promise.all([
      Exam.findAll({
        where: { instituteId, isDeleted: false },
        include: [
          { model: Subject, as: "subject", attributes: ["subjectName"], required: false },
          { model: Class, as: "class", attributes: ["className"], required: false },
        ],
        order: [["createdAt", "DESC"]],
      }),
      Student.findAll({
        where: { instituteId },
        attributes: ["createdAt"],
        raw: true,
      }),
    ]);

    const examDates = exams.map((exam) => exam.createdAt);
    const studentDates = students.map((row: any) => new Date(row.createdAt));

    const examActivityData = months.map((bucket) => ({
      month: bucket.month,
      exams: countInBucket(examDates, bucket),
      students: countInBucket(studentDates, bucket),
    }));

    const completed = exams.filter((exam) => exam.status === "Completed").length;
    const ongoing = exams.filter((exam) => exam.status === "Live").length;
    const cancelled = exams.filter((exam) => String(exam.status).toLowerCase() === "cancelled").length;
    const upcoming = exams.filter((exam) => exam.status === "Draft").length;
    const total = exams.length;

    const examStatusData = [
      {
        name: "Completed",
        value: completed,
        percentage: percentLabel(completed, total),
        color: DASHBOARD_COLORS.GREEN,
      },
      {
        name: "Upcoming",
        value: upcoming,
        percentage: percentLabel(upcoming, total),
        color: DASHBOARD_COLORS.BLUE,
      },
      {
        name: "Ongoing",
        value: ongoing,
        percentage: percentLabel(ongoing, total),
        color: DASHBOARD_COLORS.AMBER,
      },
      {
        name: "Cancelled",
        value: cancelled,
        percentage: percentLabel(cancelled, total),
        color: DASHBOARD_COLORS.RED,
      },
    ];

    const mapExamRow = (exam: any) => ({
      id: exam.id,
      name: exam.examType || "Exam",
      class: exam.class?.className || "-",
      subject: exam.subject?.subjectName || "-",
      startDate: formatDate(exam.createdAt),
      endDate: formatDate(exam.updatedAt),
      status: mapExamUiStatus(exam.status),
    });

    const recentExams = exams.filter((exam) => exam.status === "Completed").slice(0, 5).map(mapExamRow);
    const upcomingExams = exams
      .filter((exam) => ["Live", "Draft"].includes(exam.status))
      .slice(0, 5)
      .map(mapExamRow);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Student analytics fetched successfully.",
      data: {
        examActivityData,
        examStatusData,
        recentExams,
        upcomingExams,
      },
    };
  } catch (error: any) {
    console.error("getStudentAnalytics error:", error);
    return errorResult();
  }
};

const getSuperAdminAnalytics = async () => {
  try {
    const now = new Date();
    const thisYear = now.getFullYear();
    const yearBuckets = getYearMonthBuckets(thisYear);
    const prevYearBuckets = getYearMonthBuckets(thisYear - 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      institutes,
      totalStudents,
      prevStudents,
      totalExams,
      prevExams,
      evaluatedSheets,
      prevEvaluated,
      recentInstitutes,
    ] = await Promise.all([
      Institute.findAll({
        where: { isDeleted: false },
        attributes: ["id", "instituteId", "instituteName", "city", "contactPersonName", "plan", "status", "createdAt"],
        order: [["createdAt", "DESC"]],
      }),
      Student.count(),
      Student.count({ where: { createdAt: { [Op.lt]: thirtyDaysAgo } } }),
      Exam.count({ where: { isDeleted: false } }),
      Exam.count({ where: { isDeleted: false, createdAt: { [Op.lt]: thirtyDaysAgo } } }),
      Scanner.count({ where: { isDeleted: false, status: { [Op.in]: ["Evaluated", "Processed"] } } }),
      Scanner.count({
        where: {
          isDeleted: false,
          status: { [Op.in]: ["Evaluated", "Processed"] },
          createdAt: { [Op.lt]: thirtyDaysAgo },
        },
      }),
      Institute.findAll({
        where: { isDeleted: false },
        order: [["createdAt", "DESC"]],
        limit: 8,
      }),
    ]);

    const totalInstitutes = institutes.length;
    const activeInstitutes = institutes.filter((row) => row.status === 1).length;
    const prevInstitutes = institutes.filter((row) => row.createdAt < thirtyDaysAgo).length;
    const prevActive = institutes.filter((row) => row.status === 1 && row.createdAt < thirtyDaysAgo).length;

    const kpiData = [
      {
        title: "Total Institutes",
        value: formatCount(totalInstitutes),
        description: "Registered organizations",
        icon: "building",
        tone: "brand",
        ...getTrend(totalInstitutes - prevInstitutes + prevInstitutes, prevInstitutes),
      },
      {
        title: "Active Institutes",
        value: formatCount(activeInstitutes),
        description: "Currently active",
        icon: "check",
        tone: "success",
        ...getTrend(activeInstitutes, prevActive),
      },
      {
        title: "Total Students",
        value: formatCount(totalStudents),
        description: "Across platform",
        icon: "users",
        tone: "brand",
        ...getTrend(totalStudents, prevStudents),
      },
      {
        title: "Total Exams",
        value: formatCount(totalExams),
        description: "Conducted this year",
        icon: "clipboard",
        tone: "warning",
        ...getTrend(totalExams, prevExams),
      },
      {
        title: "Evaluated",
        value: formatCount(evaluatedSheets),
        description: "AI checked sheets",
        icon: "cpu",
        tone: "success",
        ...getTrend(evaluatedSheets, prevEvaluated),
      },
    ];

    const prevYearStart = new Date(thisYear - 1, 0, 1);
    const examsThisYear = await Exam.findAll({
      where: { isDeleted: false, createdAt: { [Op.gte]: prevYearStart } },
      attributes: ["createdAt"],
      raw: true,
    });

    const examDates = examsThisYear.map((row: any) => new Date(row.createdAt));
    const monthlyExamsData = yearBuckets.map((bucket) => ({
      month: bucket.month,
      exams: countInBucket(examDates, bucket),
    }));

    const revenueData = yearBuckets.map((bucket, index) => {
      const currentInstitutes = institutes.filter((row) => row.createdAt < bucket.end);
      const prevBucket = prevYearBuckets[index];
      const revenue = currentInstitutes.reduce((sum, row) => sum + getPlanMonthlyRevenue(row.plan), 0);
      const prev = institutes
        .filter((row) => row.createdAt < prevBucket.end)
        .reduce((sum, row) => sum + getPlanMonthlyRevenue(row.plan), 0);
      return {
        month: bucket.month,
        revenue: toLakhs(revenue),
        prev: toLakhs(prev),
      };
    });

    const instituteIds = recentInstitutes.map((row) => row.instituteId);
    const [examCounts, studentCounts] = await Promise.all([
      Promise.all(
        instituteIds.map((instituteId) =>
          Exam.count({ where: { instituteId, isDeleted: false } }).then((count) => [instituteId, count] as const)
        )
      ),
      Promise.all(
        instituteIds.map((instituteId) =>
          Student.count({ where: { instituteId } }).then((count) => [instituteId, count] as const)
        )
      ),
    ]);

    const examCountMap = Object.fromEntries(examCounts);
    const studentCountMap = Object.fromEntries(studentCounts);

    const recentInstituteRows = recentInstitutes.map((row) => ({
      id: row.id,
      name: row.instituteName,
      city: row.city,
      admin: row.contactPersonName,
      exams: examCountMap[row.instituteId] || 0,
      students: studentCountMap[row.instituteId] || 0,
      status: row.status === 1 ? "Active" : "Pending",
      plan: row.plan || "Starter",
      revenue: formatInrShort(getPlanMonthlyRevenue(row.plan)),
    }));

    const ytdRevenue = revenueData.reduce((sum, row) => sum + row.revenue, 0);
    const ytdExams = monthlyExamsData.reduce((sum, row) => sum + row.exams, 0);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Super admin analytics fetched successfully.",
      data: {
        kpiData,
        revenueData,
        monthlyExamsData,
        recentInstitutes: recentInstituteRows,
        ytdRevenue: Number(ytdRevenue.toFixed(1)),
        ytdExams,
      },
    };
  } catch (error: any) {
    console.error("getSuperAdminAnalytics error:", error);
    return errorResult();
  }
};

export default {
  getOverview,
  getTeacherAnalytics,
  getScannerAnalytics,
  getStudentAnalytics,
  getSuperAdminAnalytics,
};
