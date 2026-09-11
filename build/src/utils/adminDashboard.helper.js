"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEACHER_QUICK_ACTIONS = exports.getTrend = exports.mapExamUiStatus = exports.mapSheetStatus = exports.getSubjectIcon = exports.getExamStyle = exports.getRoleColor = exports.getPlanMonthlyRevenue = exports.toLakhs = exports.formatInrShort = exports.formatCount = exports.timeAgo = exports.formatDate = exports.percentValue = exports.percentLabel = exports.countInBucket = exports.getYearMonthBuckets = exports.getMonthBuckets = exports.DASHBOARD_COLORS = void 0;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
exports.DASHBOARD_COLORS = {
    BLUE: "#4F6EF7",
    GREEN: "#22B573",
    INDIGO: "#8B7CF6",
    CYAN: "#43C6D7",
    RED: "#EF5B67",
    AMBER: "#F59E0B",
};
const ROLE_COLORS = {
    "Subject Teacher": exports.DASHBOARD_COLORS.BLUE,
    "Class Teacher": exports.DASHBOARD_COLORS.GREEN,
    "Head Teacher": exports.DASHBOARD_COLORS.INDIGO,
};
const EXAM_PALETTE = [
    {
        iconColor: exports.DASHBOARD_COLORS.BLUE,
        iconBg: "#EEF4FF",
        chipBg: "#EEF4FF",
        chipColor: exports.DASHBOARD_COLORS.BLUE,
    },
    {
        iconColor: exports.DASHBOARD_COLORS.GREEN,
        iconBg: "#EAFBF3",
        chipBg: "#EAFBF3",
        chipColor: exports.DASHBOARD_COLORS.GREEN,
    },
    {
        iconColor: exports.DASHBOARD_COLORS.INDIGO,
        iconBg: "#F1ECFF",
        chipBg: "#F1ECFF",
        chipColor: exports.DASHBOARD_COLORS.INDIGO,
    },
];
const PLAN_MONTHLY_INR = {
    starter: 12000,
    pro: 48000,
    enterprise: 86000,
};
const getMonthBuckets = (count, from = new Date()) => {
    const buckets = [];
    for (let i = count - 1; i >= 0; i -= 1) {
        const start = new Date(from.getFullYear(), from.getMonth() - i, 1);
        const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        buckets.push({
            key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
            month: MONTH_LABELS[start.getMonth()],
            year: start.getFullYear(),
            monthIndex: start.getMonth(),
            start,
            end,
        });
    }
    return buckets;
};
exports.getMonthBuckets = getMonthBuckets;
const getYearMonthBuckets = (year) => {
    return MONTH_LABELS.map((_, monthIndex) => {
        const start = new Date(year, monthIndex, 1);
        const end = new Date(year, monthIndex + 1, 1);
        return {
            key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
            month: MONTH_LABELS[monthIndex],
            year,
            monthIndex,
            start,
            end,
        };
    });
};
exports.getYearMonthBuckets = getYearMonthBuckets;
const countInBucket = (dates, bucket) => {
    return dates.filter((date) => date >= bucket.start && date < bucket.end).length;
};
exports.countInBucket = countInBucket;
const percentLabel = (value, total) => {
    if (!total)
        return "0%";
    return `${Math.round((value / total) * 100)}%`;
};
exports.percentLabel = percentLabel;
const percentValue = (value, total) => {
    if (!total)
        return 0;
    return Math.round((value / total) * 100);
};
exports.percentValue = percentValue;
const formatDate = (date) => {
    if (!date)
        return "-";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime()))
        return "-";
    return parsed.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
};
exports.formatDate = formatDate;
const timeAgo = (date) => {
    if (!date)
        return "-";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime()))
        return "-";
    const seconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
    if (seconds < 60)
        return `${seconds} secs ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes} mins ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 30)
        return `${days} day${days === 1 ? "" : "s"} ago`;
    const months = Math.floor(days / 30);
    return `${months} month${months === 1 ? "" : "s"} ago`;
};
exports.timeAgo = timeAgo;
const formatCount = (value) => {
    return value.toLocaleString("en-IN");
};
exports.formatCount = formatCount;
const formatInrShort = (value) => {
    if (value >= 100000) {
        const lakhs = value / 100000;
        return `₹${lakhs % 1 === 0 ? lakhs.toFixed(0) : lakhs.toFixed(1)}L`;
    }
    if (value >= 1000) {
        return `₹${Math.round(value / 1000)}K`;
    }
    return `₹${value}`;
};
exports.formatInrShort = formatInrShort;
const toLakhs = (value) => {
    return Number((value / 100000).toFixed(1));
};
exports.toLakhs = toLakhs;
const getPlanMonthlyRevenue = (plan) => {
    var _a;
    const key = String(plan || "starter").toLowerCase();
    return (_a = PLAN_MONTHLY_INR[key]) !== null && _a !== void 0 ? _a : PLAN_MONTHLY_INR.starter;
};
exports.getPlanMonthlyRevenue = getPlanMonthlyRevenue;
const getRoleColor = (role, index) => {
    if (ROLE_COLORS[role])
        return ROLE_COLORS[role];
    const palette = [
        exports.DASHBOARD_COLORS.BLUE,
        exports.DASHBOARD_COLORS.GREEN,
        exports.DASHBOARD_COLORS.INDIGO,
        exports.DASHBOARD_COLORS.AMBER,
        exports.DASHBOARD_COLORS.RED,
        exports.DASHBOARD_COLORS.CYAN,
    ];
    return palette[index % palette.length];
};
exports.getRoleColor = getRoleColor;
const getExamStyle = (index) => EXAM_PALETTE[index % EXAM_PALETTE.length];
exports.getExamStyle = getExamStyle;
const getSubjectIcon = (subjectName) => {
    const name = String(subjectName || "").toLowerCase();
    if (/(science|physics|chemistry|biology)/.test(name))
        return "Science";
    return "MenuBook";
};
exports.getSubjectIcon = getSubjectIcon;
const mapSheetStatus = (status) => {
    const value = String(status || "").toLowerCase();
    if (value === "evaluated" || value === "processed" || value === "success")
        return "Processed";
    if (value === "failed" || value === "rejected")
        return "Failed";
    return "Pending";
};
exports.mapSheetStatus = mapSheetStatus;
const mapExamUiStatus = (status) => {
    const value = String(status || "").toLowerCase();
    if (value === "completed")
        return "Completed";
    if (value === "live")
        return "Ongoing";
    if (value === "cancelled")
        return "Cancelled";
    return "Upcoming";
};
exports.mapExamUiStatus = mapExamUiStatus;
const getTrend = (current, previous) => {
    if (!previous) {
        return {
            trend: current ? "+100%" : "0%",
            up: current >= previous,
        };
    }
    const change = ((current - previous) / previous) * 100;
    const rounded = Math.abs(change) >= 10 ? change.toFixed(0) : change.toFixed(1);
    return {
        trend: `${change >= 0 ? "+" : ""}${rounded}%`,
        up: change >= 0,
    };
};
exports.getTrend = getTrend;
exports.TEACHER_QUICK_ACTIONS = [
    {
        title: "Reports",
        description: "View academic reports and analytics",
        icon: "Analytics",
        color: "#2563eb",
        bg: "#eff6ff",
    },
    {
        title: "Tasks",
        description: "Manage daily teaching tasks",
        icon: "TaskAlt",
        color: "#16a34a",
        bg: "#f0fdf4",
    },
    {
        title: "Student Performance",
        description: "Track marks and student growth",
        icon: "TrendingUp",
        color: "#9333ea",
        bg: "#f3e8ff",
    },
    {
        title: "Question Paper Creation",
        description: "Create and manage question papers",
        icon: "Quiz",
        color: "#3D5CE5",
        bg: "#fff7ed",
    },
    {
        title: "Answer Sheet Creation",
        description: "Generate answer sheets quickly",
        icon: "Description",
        color: "#0f766e",
        bg: "#ecfeff",
    },
    {
        title: "Answer Sheet Evaluation",
        description: "Evaluate and grade answer sheets",
        icon: "Grading",
        color: "#dc2626",
        bg: "#fef2f2",
    },
    {
        title: "Recheck Evaluation",
        description: "Review and recheck evaluations",
        icon: "Autorenew",
        color: "#7c3aed",
        bg: "#f5f3ff",
    },
];
