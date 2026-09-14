import httpStatus from "http-status";
import { Op } from "sequelize";
import Scanner from "../modals/Scanner.modal";
import Exam from "../modals/Exam.modal";
import Subject from "../modals/Subject.modal";
import Student from "../modals/Student.modal";
import User from "../modals/User.modal";
import Role from "../modals/Role.modal";
import ActivityLog from "../modals/ActivityLog.modal";
import {
  DASHBOARD_COLORS,
  computeScannerStatusBreakdown,
  formatCount,
  mapSheetStatus,
  percentValue,
  timeAgo,
} from "../utils/adminDashboard.helper";

const missingInstitute = () => ({
  error: true,
  statusCode: httpStatus.BAD_REQUEST,
  message: "Institute ID not found for user.",
});

const errorResult = (message = "Something went wrong.") => ({
  error: true,
  statusCode: httpStatus.INTERNAL_SERVER_ERROR,
  message,
});

const getTodayRange = (): { start: Date; end: Date } => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

// ─── KPIs ───────────────────────────────────────────────────────────────────
// NOTE: no write path in this codebase ever sets Scanner.status to "Failed"/
// "Rejected" today (see scanner.service.ts::updateSheetStatus — only
// "Pending"/"Evaluated" are ever written). So `status !== "Evaluated"` is a
// DB-pushable equivalent of `mapSheetStatus(status) === "Pending"` for KPI
// counts here. If a Failed/Rejected write path is added later, switch this to
// fetching `status` and filtering in JS via mapSheetStatus instead.
const getKpis = async (instituteId: string) => {
  try {
    if (!instituteId) return missingInstitute();

    const { start, end } = getTodayRange();
    const scannerRole = await Role.findOne({ where: { role: "SCANNER" } });

    const [totalScansToday, pendingVerification, activeExams, activeScanners] = await Promise.all([
      Scanner.count({
        where: { instituteId, isDeleted: false, createdAt: { [Op.gte]: start, [Op.lt]: end } },
      }),
      Scanner.count({
        where: { instituteId, isDeleted: false, status: { [Op.ne]: "Evaluated" } },
      }),
      Exam.count({ where: { instituteId, isDeleted: false, status: "Live" } }),
      User.count({ where: { instituteId, roleId: scannerRole?.id ?? -1, status: 1 } }),
    ]);

    const kpis = [
      {
        title: "Total Scans Today",
        value: formatCount(totalScansToday),
        icon: "DocumentScanner",
        iconBg: "#CFE8FF",
        iconColor: "#3C91E6",
      },
      {
        title: "Pending Verification",
        value: formatCount(pendingVerification),
        icon: "PendingActions",
        iconBg: "#FEF3C7",
        iconColor: "#D97706",
      },
      {
        title: "Active Exams",
        value: formatCount(activeExams),
        icon: "EventAvailable",
        iconBg: "#EDE9FE",
        iconColor: "#7C3AED",
      },
      {
        title: "Active Scanners",
        value: formatCount(activeScanners),
        icon: "Groups",
        iconBg: "#DCFCE7",
        iconColor: "#16A34A",
      },
    ];

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scanner dashboard KPIs fetched successfully.",
      data: { kpis },
    };
  } catch (error: any) {
    console.error("getKpis error:", error);
    return errorResult();
  }
};

// ─── HOURLY ACTIVITY (today) ────────────────────────────────────────────────
const HOURLY_START = 8; // 8 AM
const HOURLY_END_CAP = 18; // never render past 6 PM

const buildHourBuckets = (now: Date) => {
  const lastHour = Math.min(Math.max(now.getHours(), HOURLY_START), HOURLY_END_CAP);
  const buckets: { label: string; start: Date; end: Date }[] = [];
  for (let h = HOURLY_START; h <= lastHour; h += 1) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h + 1, 0, 0);
    const label = h === 12 ? "12 PM" : h > 12 ? `${h - 12} PM` : `${h} AM`;
    buckets.push({ label, start, end });
  }
  return buckets;
};

const getHourlyActivity = async (instituteId: string) => {
  try {
    if (!instituteId) return missingInstitute();

    const { start, end } = getTodayRange();
    const sheets = await Scanner.findAll({
      where: { instituteId, isDeleted: false, createdAt: { [Op.gte]: start, [Op.lt]: end } },
      attributes: ["createdAt"],
      raw: true,
    });

    const dates = sheets.map((row: any) => new Date(row.createdAt));
    const buckets = buildHourBuckets(new Date());
    const hourly = buckets.map((bucket) => ({
      time: bucket.label,
      scans: dates.filter((d) => d >= bucket.start && d < bucket.end).length,
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Hourly scan activity fetched successfully.",
      data: { hourly },
    };
  } catch (error: any) {
    console.error("getHourlyActivity error:", error);
    return errorResult();
  }
};

// ─── STATUS DISTRIBUTION ─────────────────────────────────────────────────────
const getStatusDistribution = async (instituteId: string) => {
  try {
    if (!instituteId) return missingInstitute();

    const sheets = await Scanner.findAll({
      where: { instituteId, isDeleted: false },
      attributes: ["status"],
      raw: true,
    });

    const { statusData } = computeScannerStatusBreakdown(sheets);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Scan status distribution fetched successfully.",
      data: { statusData },
    };
  } catch (error: any) {
    console.error("getStatusDistribution error:", error);
    return errorResult();
  }
};

// ─── RECENT SCANS ────────────────────────────────────────────────────────────
const getRecentScans = async (instituteId: string) => {
  try {
    if (!instituteId) return missingInstitute();

    const rows = await Scanner.findAll({
      where: { instituteId, isDeleted: false },
      attributes: ["sheetId", "studentName", "rollNo", "examType", "status", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 6,
      raw: true,
    });

    const recentScans = rows.map((row: any) => ({
      id: row.sheetId,
      studentName: row.studentName || `Roll No. ${row.rollNo}`,
      exam: row.examType,
      time: new Date(row.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      status: mapSheetStatus(row.status),
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Recent scans fetched successfully.",
      data: { recentScans },
    };
  } catch (error: any) {
    console.error("getRecentScans error:", error);
    return errorResult();
  }
};

// ─── EXAM PROGRESS ───────────────────────────────────────────────────────────
const getExamProgress = async (instituteId: string) => {
  try {
    if (!instituteId) return missingInstitute();

    const exams = await Exam.findAll({
      where: { instituteId, isDeleted: false, status: { [Op.in]: ["Live", "Completed"] } },
      attributes: ["examId", "classId", "subjectId", "examType", "createdAt"],
      order: [["createdAt", "DESC"]],
      limit: 8,
      raw: true,
    });

    const classIds = [...new Set(exams.map((e: any) => e.classId).filter(Boolean))];
    const subjectIds = [...new Set(exams.map((e: any) => e.subjectId).filter(Boolean))];

    const [subjects, studentRows, scannerRows] = await Promise.all([
      subjectIds.length
        ? Subject.findAll({ where: { subjectId: { [Op.in]: subjectIds } }, attributes: ["subjectId", "subjectName"], raw: true })
        : [],
      classIds.length
        ? Student.findAll({ where: { instituteId, classId: { [Op.in]: classIds } }, attributes: ["classId"], raw: true })
        : [],
      classIds.length
        ? Scanner.findAll({
            where: { instituteId, isDeleted: false, classId: { [Op.in]: classIds } },
            attributes: ["classId", "subjectId", "examType"],
            raw: true,
          })
        : [],
    ]);

    const subjectMap = Object.fromEntries(subjects.map((s: any) => [s.subjectId, s.subjectName]));

    const studentCountByClass: Record<string, number> = {};
    studentRows.forEach((r: any) => {
      studentCountByClass[r.classId] = (studentCountByClass[r.classId] || 0) + 1;
    });

    const scannedCountByKey: Record<string, number> = {};
    scannerRows.forEach((r: any) => {
      const key = `${r.classId}|${r.subjectId}|${r.examType}`;
      scannedCountByKey[key] = (scannedCountByKey[key] || 0) + 1;
    });

    const examProgress = exams.map((exam: any) => {
      const key = `${exam.classId}|${exam.subjectId}|${exam.examType}`;
      const totalSheets = studentCountByClass[exam.classId] || 0;
      const scanned = scannedCountByKey[key] || 0;
      const subjectName = subjectMap[exam.subjectId] || exam.examType;
      return {
        id: exam.examId,
        exam: `${subjectName} ${exam.examType}`,
        totalSheets,
        scanned,
        progress: percentValue(scanned, totalSheets),
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Exam progress fetched successfully.",
      data: { examProgress },
    };
  } catch (error: any) {
    console.error("getExamProgress error:", error);
    return errorResult();
  }
};

// ─── PENDING SCANS (uploaded, awaiting verification) ────────────────────────
const getPendingScans = async (instituteId: string) => {
  try {
    if (!instituteId) return missingInstitute();

    const rows = await Scanner.findAll({
      where: { instituteId, isDeleted: false, status: { [Op.ne]: "Evaluated" } },
      attributes: ["sheetId", "studentName", "rollNo", "examType", "uploadedBy", "createdAt"],
      order: [["createdAt", "ASC"]],
      limit: 10,
      raw: true,
    });

    const uploaderIds = [...new Set(rows.map((r: any) => r.uploadedBy).filter(Boolean))];
    const uploaders = uploaderIds.length
      ? await User.findAll({ where: { userId: { [Op.in]: uploaderIds } }, attributes: ["userId", "userName"], raw: true })
      : [];
    const userMap = Object.fromEntries(uploaders.map((u: any) => [u.userId, u.userName]));

    const pendingScans = rows.map((row: any) => ({
      id: row.sheetId,
      studentName: row.studentName || `Roll No. ${row.rollNo}`,
      exam: row.examType,
      assignedTo: userMap[row.uploadedBy] || "Unknown",
      waitingSince: timeAgo(row.createdAt),
    }));

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Pending scans fetched successfully.",
      data: { pendingScans },
    };
  } catch (error: any) {
    console.error("getPendingScans error:", error);
    return errorResult();
  }
};

// ─── RECENT ACTIVITY ─────────────────────────────────────────────────────────
const ACTIVITY_STYLE: Record<string, { icon: string; iconBg: string; iconColor: string }> = {
  SHEET_UPLOAD_COMPLETED: { icon: "Upload", iconBg: "#FEF3C7", iconColor: "#D97706" },
  SHEET_UPLOADED: { icon: "Upload", iconBg: "#FEF3C7", iconColor: "#D97706" },
  SHEET_STATUS_UPDATED: { icon: "Verified", iconBg: "#DBEAFE", iconColor: "#2563EB" },
  EVALUATION_COMPLETED: { icon: "Verified", iconBg: "#DBEAFE", iconColor: "#2563EB" },
  EXAM_STARTED: { icon: "Add", iconBg: "#EDE9FE", iconColor: "#7C3AED" },
};
const DEFAULT_ACTIVITY_STYLE = { icon: "Verified", iconBg: "#DBEAFE", iconColor: "#2563EB" };
const FAILED_ACTIVITY_STYLE = { icon: "Error", iconBg: "#FEF2F2", iconColor: DASHBOARD_COLORS.RED };

const getRecentActivity = async (instituteId: string) => {
  try {
    if (!instituteId) return missingInstitute();

    const logs = await ActivityLog.findAll({
      where: { instituteId, role: { [Op.iLike]: "%scanner%" } },
      order: [["createdAt", "DESC"]],
      limit: 6,
    }).catch(() => []);

    const recentActivity = (logs as any[]).map((log) => {
      const style = log.status === "FAILED" ? FAILED_ACTIVITY_STYLE : ACTIVITY_STYLE[log.eventType] || DEFAULT_ACTIVITY_STYLE;
      const humanEvent = String(log.eventType || "Activity").replace(/_/g, " ").toLowerCase();
      const text = `${humanEvent}${log.entityId ? ` (${log.entityId})` : ""}`;
      return {
        id: log.eventId,
        text: text.charAt(0).toUpperCase() + text.slice(1),
        time: timeAgo(log.createdAt),
        ...style,
      };
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Recent activity fetched successfully.",
      data: { recentActivity },
    };
  } catch (error: any) {
    console.error("getRecentActivity error:", error);
    return errorResult();
  }
};

export default {
  getKpis,
  getHourlyActivity,
  getStatusDistribution,
  getRecentScans,
  getExamProgress,
  getPendingScans,
  getRecentActivity,
};
