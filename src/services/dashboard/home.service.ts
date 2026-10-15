import { settingsOf } from "../academic/instituteSettings.service";
import httpStatus from "http-status";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import { memoize } from "../../utils/memoCache";
import { buildRoster, loadExam } from "../exam/examRoster.service";
import ExamWorkflowService, { PAPER_APPROVED_STATUSES } from "../exam/examWorkflow.service";

// Home pages of the institute roles (admin, teacher, scanner, student). Each page is
// one request: a few aggregate SQL statements run in parallel, nothing is loaded into
// Node just to be counted. Results are cached briefly per institute / per user, so a
// page refresh or a second tab costs nothing.
//
// Exam stages follow examWorkflow.stageOf(); the only approximation is that an exam
// without a scanner counts as "scanning" once any sheet tagged with it is uploaded
// (the workflow page decides "scan finished" from the full roster). When the school
// cross-checks, a reviewed exam waits in CROSS_CHECK until its round is done.

const TZ = "Asia/Kolkata";
const ADMIN_CACHE_MS = 30_000;
const USER_CACHE_MS = 15_000;
const DAYS = 14;

const ok = (message: string, data: unknown) => ({ error: false, statusCode: httpStatus.OK, message, data });
const fail = (scope: string, e: any) => {
  logger.error(`[Home] ${scope}: ${e?.message || e}`);
  return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not load the home page data." };
};

const num = (v: unknown) => Number(v) || 0;
const pctOrNull = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);

const select = <T extends object = any>(sql: string, replacements: Record<string, unknown>): Promise<T[]> =>
  sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements: { tz: TZ, ...replacements } });

// Shared SQL fragments ─────────────────────────────────────────────────────────

const TODAY = `(now() AT TIME ZONE :tz)::date`;
// First instant of the day (DAYS - 1) days ago, in the institute's time zone.
const SERIES_START = `((date_trunc('day', now() AT TIME ZONE :tz) - (:days - 1) * interval '1 day') AT TIME ZONE :tz)`;
const DAY_SERIES = `SELECT generate_series(${TODAY} - (:days - 1), ${TODAY}, interval '1 day')::date AS day`;

/** Exam statuses while its paper is with the setter: not started, being written, sent back. */
const PAPER_WITH_SETTER = ["Draft", "Paper Created", "Rejected"];

/** The current session (none when no session is marked current). */
const CURRENT_SESSION = `SELECT "sessionId" FROM viaexam_sessions
  WHERE "instituteId" = :inst AND "isDeleted" = false AND "isActive" = true
  ORDER BY "startDate" DESC NULLS LAST LIMIT 1`;
/** Exam `e` is in the current session (every exam counts when none is current). Needs `cur`. */
const IN_CURRENT_SESSION = `(NOT EXISTS (SELECT 1 FROM cur) OR e."sessionId" = (SELECT "sessionId" FROM cur))`;

/** Joins that turn an exam row `e` into display names. */
const EXAM_NAMES = `
  LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
  LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
  LEFT JOIN viaexam_subjects sub ON sub."subjectId" = e."subjectId"`;
const EXAM_COLUMNS = `e."examId", e."examType", e."examDate", e."examTime", e.status,
  c."className", sec."sectionName", sub."subjectName"`;

const examRow = (r: any) => ({
  examId: r.examId,
  examType: r.examType ?? "",
  examDate: r.examDate ?? null,
  examTime: r.examTime ?? null,
  status: r.status ?? "",
  className: r.className ?? "",
  sectionName: r.sectionName ?? "",
  subjectName: r.subjectName ?? "",
});

const series = (rows: any[]) => rows.map((r) => ({ day: r.day, uploaded: num(r.uploaded), evaluated: num(r.evaluated) }));

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN
// ═════════════════════════════════════════════════════════════════════════════

const ADMIN_SUMMARY_SQL = `
WITH b AS (SELECT (date_trunc('month', now() AT TIME ZONE :tz) AT TIME ZONE :tz) AS m0),
ex AS (SELECT "examId", status, "examDate" FROM viaexam_exams WHERE "instituteId" = :inst AND "isDeleted" = false),
pub AS (SELECT DISTINCT "examId" FROM viaexam_student_results WHERE "instituteId" = :inst AND "isDeleted" = false),
sc AS (SELECT "examId", status FROM viaexam_exam_scanner_assignments WHERE "instituteId" = :inst AND "isActive" = true),
ev AS (SELECT "examId", "reviewedAt" FROM viaexam_evaluation_assignments WHERE "instituteId" = :inst AND "isActive" = true),
up AS (SELECT DISTINCT "examId" FROM viaexam_answer_sheets WHERE "instituteId" = :inst AND "isDeleted" = false AND "examId" IS NOT NULL),
xr AS (
  SELECT r."examId", COUNT(i."id") FILTER (WHERE i.status = 'pending')::int AS pending
  FROM viaexam_cross_check_rounds r
  LEFT JOIN viaexam_cross_check_items i ON i."roundId" = r."roundId"
  WHERE r."instituteId" = :inst AND r."isActive" = true
  GROUP BY r."examId"
),
st AS (
  SELECT ex."examId", ex."examDate",
         CASE
           WHEN pub."examId" IS NOT NULL THEN 'PUBLISHED'
           WHEN ex.status NOT IN (:approved) THEN 'PAPER_PENDING'
           WHEN ev."reviewedAt" IS NOT NULL AND :crossCheck AND (xr."examId" IS NULL OR xr.pending > 0) THEN 'CROSS_CHECK'
           WHEN ev."reviewedAt" IS NOT NULL THEN 'REVIEWED'
           WHEN sc.status = 'COMPLETED' THEN 'EVALUATING'
           WHEN sc."examId" IS NOT NULL OR up."examId" IS NOT NULL THEN 'SCANNING'
           ELSE 'READY_TO_SCAN'
         END AS stage,
         sc."examId" IS NOT NULL OR up."examId" IS NOT NULL AS scan_started,
         ev."examId" IS NOT NULL AS has_evaluator
  FROM ex
  LEFT JOIN pub ON pub."examId" = ex."examId"
  LEFT JOIN sc ON sc."examId" = ex."examId"
  LEFT JOIN ev ON ev."examId" = ex."examId"
  LEFT JOIN up ON up."examId" = ex."examId"
  LEFT JOIN xr ON xr."examId" = ex."examId"
),
stage AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE "examDate" = ${TODAY})::int AS today,
         COUNT(*) FILTER (WHERE "examDate" > ${TODAY} AND "examDate" <= ${TODAY} + 7)::int AS next7,
         COUNT(*) FILTER (WHERE stage = 'PAPER_PENDING')::int AS paper_pending,
         COUNT(*) FILTER (WHERE stage = 'READY_TO_SCAN')::int AS ready_to_scan,
         COUNT(*) FILTER (WHERE stage = 'SCANNING')::int AS scanning,
         COUNT(*) FILTER (WHERE stage = 'EVALUATING')::int AS evaluating,
         COUNT(*) FILTER (WHERE stage = 'CROSS_CHECK')::int AS cross_check,
         COUNT(*) FILTER (WHERE stage = 'REVIEWED')::int AS reviewed,
         COUNT(*) FILTER (WHERE stage = 'PUBLISHED')::int AS published,
         COUNT(*) FILTER (WHERE stage IN ('READY_TO_SCAN', 'SCANNING', 'EVALUATING') AND NOT has_evaluator)::int AS needs_evaluator
  FROM st
),
ppl AS (
  SELECT COUNT(*) FILTER (WHERE r.role = 'STUDENT')::int AS students,
         COUNT(*) FILTER (WHERE r.role = 'STUDENT' AND u."createdAt" >= b.m0)::int AS students_month,
         COUNT(*) FILTER (WHERE r.role = 'TEACHER')::int AS teachers,
         COUNT(*) FILTER (WHERE r.role = 'SCANNER')::int AS scanners
  FROM viaexam_users u
  JOIN roles r ON r.id = u."roleId"
  CROSS JOIN b
  WHERE u."instituteId" = :inst AND u."isDeleted" = false AND u.status = 1
),
aca AS (
  SELECT (SELECT COUNT(*) FROM viaexam_classes WHERE "instituteId" = :inst AND "isDeleted" = false)::int AS classes,
         (SELECT COUNT(*) FROM viaexam_sections WHERE "instituteId" = :inst AND "isDeleted" = false)::int AS sections,
         (SELECT COUNT(*) FROM viaexam_subjects WHERE "instituteId" = :inst AND "isDeleted" = false)::int AS subjects
),
sht AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE s.status IN ('Evaluated', 'Processed'))::int AS evaluated,
         COUNT(*) FILTER (WHERE s.status = 'Pending')::int AS pending,
         COUNT(*) FILTER (WHERE s."createdAt" >= (date_trunc('day', now() AT TIME ZONE :tz) AT TIME ZONE :tz))::int AS today
  FROM viaexam_answer_sheets s
  WHERE s."instituteId" = :inst AND s."isDeleted" = false
),
evf AS (
  SELECT COUNT(*)::int AS failed
  FROM viaexam_ai_evaluations e
  JOIN viaexam_answer_sheets s ON s."sheetId" = e."sheetId"
  WHERE s."instituteId" = :inst AND s."isDeleted" = false AND e.status = 'Failed'
),
cur AS (${CURRENT_SESSION}),
-- Papers still with their setters this session; "late" when the exam is a week away or past.
pw AS (
  SELECT COUNT(*)::int AS open_count,
         COUNT(*) FILTER (WHERE e."examDate" <= ${TODAY} + 7)::int AS late_count
  FROM viaexam_exams e
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e.status IN (:withSetter) AND ${IN_CURRENT_SESSION}
)
SELECT stage.*, ppl.*, aca.*,
       sht.total AS sheets_total, sht.evaluated AS sheets_evaluated, sht.pending AS sheets_pending, sht.today AS sheets_today,
       evf.failed AS evaluations_failed,
       pw.open_count AS papers_open, pw.late_count AS papers_late,
       (SELECT COUNT(*) FROM viaexam_question_papers q
         WHERE q."instituteId" = :inst AND q.status = 'PENDING_APPROVAL' AND q."deletedAt" IS NULL)::int AS papers_pending,
       (SELECT COUNT(*) FROM viaexam_recheck_requests rr
         WHERE rr."instituteId" = :inst AND rr.status = 'Pending')::int AS rechecks_pending,
       (SELECT "sessionName" FROM viaexam_sessions
         WHERE "instituteId" = :inst AND "isDeleted" = false AND "isActive" = true
         ORDER BY "startDate" DESC NULLS LAST LIMIT 1) AS session_name
FROM stage, ppl, aca, sht, evf, pw`;

const ADMIN_DAILY_SQL = `
WITH days AS (${DAY_SERIES}),
up AS (
  SELECT (s."createdAt" AT TIME ZONE :tz)::date AS day, COUNT(*)::int AS n
  FROM viaexam_answer_sheets s
  WHERE s."instituteId" = :inst AND s."isDeleted" = false AND s."createdAt" >= ${SERIES_START}
  GROUP BY 1
),
ev AS (
  SELECT (e."updatedAt" AT TIME ZONE :tz)::date AS day, COUNT(*)::int AS n
  FROM viaexam_ai_evaluations e
  JOIN viaexam_answer_sheets s ON s."sheetId" = e."sheetId"
  WHERE s."instituteId" = :inst AND s."isDeleted" = false AND e.status = 'Success' AND e."updatedAt" >= ${SERIES_START}
  GROUP BY 1
)
SELECT to_char(days.day, 'YYYY-MM-DD') AS day, COALESCE(up.n, 0) AS uploaded, COALESCE(ev.n, 0) AS evaluated
FROM days
LEFT JOIN up ON up.day = days.day
LEFT JOIN ev ON ev.day = days.day
ORDER BY days.day`;

const ADMIN_UPCOMING_SQL = `
SELECT ${EXAM_COLUMNS}, u."userName" AS "teacherName"
FROM viaexam_exams e
${EXAM_NAMES}
LEFT JOIN viaexam_users u ON u."userId" = e."teacherId"
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."examDate" >= ${TODAY}
ORDER BY e."examDate", e."examTime" NULLS LAST, e."createdAt"
LIMIT 6`;

const ADMIN_APPROVALS_SQL = `
SELECT q."paperId", q.paper_set AS "paperSet", q."submittedAt", u."userName" AS "teacherName", ${EXAM_COLUMNS}
FROM viaexam_question_papers q
JOIN viaexam_exams e ON e."examId" = q."examId" AND e."isDeleted" = false
${EXAM_NAMES}
LEFT JOIN viaexam_users u ON u."userId" = q."teacherId"
WHERE q."instituteId" = :inst AND q.status = 'PENDING_APPROVAL' AND q."deletedAt" IS NULL
ORDER BY q."submittedAt" NULLS LAST, q."createdAt"
LIMIT 5`;

// Papers still with their setters this session, nearest exam first (late ones on top).
const ADMIN_PAPER_SETTING_SQL = `
WITH cur AS (${CURRENT_SESSION})
SELECT ${EXAM_COLUMNS}, e."teacherId", u."userName" AS "teacherName"
FROM viaexam_exams e
${EXAM_NAMES}
LEFT JOIN viaexam_users u ON u."userId" = e."teacherId"
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e.status IN (:withSetter) AND ${IN_CURRENT_SESSION}
ORDER BY e."examDate" NULLS LAST, e."examTime" NULLS LAST, e."createdAt"
LIMIT 6`;

const ADMIN_RECHECKS_SQL = `
SELECT rr."requestId", rr."createdAt", u."userName" AS "studentName", ${EXAM_COLUMNS}
FROM viaexam_recheck_requests rr
JOIN viaexam_exams e ON e."examId" = rr."examId"
${EXAM_NAMES}
LEFT JOIN viaexam_users u ON u."userId" = rr."studentId"
WHERE rr."instituteId" = :inst AND rr.status = 'Pending'
ORDER BY rr."createdAt"
LIMIT 5`;

// Open work per person. Teachers: papers to set (this session), exams to evaluate,
// cross-checks and rechecks; scanner staff: exams to scan.
const ADMIN_WORKLOAD_SQL = `
WITH cur AS (${CURRENT_SESSION}),
w AS (
  SELECT e."teacherId" AS "userId", 'papers' AS kind, COUNT(*)::int AS n
  FROM viaexam_exams e
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."teacherId" IS NOT NULL
    AND e.status IN (:withSetter) AND ${IN_CURRENT_SESSION}
  GROUP BY 1
  UNION ALL
  SELECT a."teacherId", 'evaluations', COUNT(*)::int
  FROM viaexam_evaluation_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false
  WHERE a."instituteId" = :inst AND a."isActive" = true AND a."reviewedAt" IS NULL
  GROUP BY 1
  UNION ALL
  SELECT r."checkerId", 'crossChecks', COUNT(*)::int
  FROM viaexam_cross_check_rounds r
  JOIN viaexam_exams e ON e."examId" = r."examId" AND e."isDeleted" = false
  WHERE r."instituteId" = :inst AND r."isActive" = true AND r.status = 'open'
  GROUP BY 1
  UNION ALL
  SELECT ra."teacherId", 'rechecks', COUNT(*)::int
  FROM viaexam_recheck_assignments ra
  WHERE ra."instituteId" = :inst AND ra."completedAt" IS NULL
  GROUP BY 1
  UNION ALL
  SELECT a."scannerId", 'scans', COUNT(*)::int
  FROM viaexam_exam_scanner_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false
  WHERE a."instituteId" = :inst AND a."isActive" = true AND a.status = 'ASSIGNED'
  GROUP BY 1
)
SELECT u."userId", u."userName" AS name, ro.role,
       COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'papers'), 0)::int AS papers,
       COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'evaluations'), 0)::int AS evaluations,
       COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'crossChecks'), 0)::int AS "crossChecks",
       COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'rechecks'), 0)::int AS rechecks,
       COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'scans'), 0)::int AS scans,
       SUM(w.n)::int AS total
FROM w
JOIN viaexam_users u ON u."userId" = w."userId"
JOIN roles ro ON ro.id = u."roleId"
GROUP BY u."userId", u."userName", ro.role
ORDER BY total DESC, u."userName"
LIMIT 8`;

// What was added each month over the last 12 months (the lines on the number cards).
const ADMIN_TRENDS_SQL = `
WITH months AS (
  SELECT generate_series(date_trunc('month', now() AT TIME ZONE :tz) - interval '11 months',
                         date_trunc('month', now() AT TIME ZONE :tz), interval '1 month') AS m
),
since AS (SELECT (MIN(m) AT TIME ZONE :tz) AS t FROM months),
ppl AS (
  SELECT date_trunc('month', u."createdAt" AT TIME ZONE :tz) AS m,
         COUNT(*) FILTER (WHERE r.role = 'STUDENT')::int AS students,
         COUNT(*) FILTER (WHERE r.role = 'TEACHER')::int AS teachers,
         COUNT(*) FILTER (WHERE r.role = 'SCANNER')::int AS scanners
  FROM viaexam_users u JOIN roles r ON r.id = u."roleId", since
  WHERE u."instituteId" = :inst AND u."isDeleted" = false AND u."createdAt" >= since.t
  GROUP BY 1
),
ex AS (
  SELECT date_trunc('month', e."createdAt" AT TIME ZONE :tz) AS m, COUNT(*)::int AS n
  FROM viaexam_exams e, since
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."createdAt" >= since.t
  GROUP BY 1
),
sh AS (
  SELECT date_trunc('month', s."createdAt" AT TIME ZONE :tz) AS m, COUNT(*)::int AS n
  FROM viaexam_answer_sheets s, since
  WHERE s."instituteId" = :inst AND s."isDeleted" = false AND s."createdAt" >= since.t
  GROUP BY 1
)
SELECT to_char(months.m, 'YYYY-MM') AS month,
       COALESCE(ppl.students, 0) AS students, COALESCE(ppl.teachers, 0) AS teachers, COALESCE(ppl.scanners, 0) AS scanners,
       COALESCE(ex.n, 0) AS exams, COALESCE(sh.n, 0) AS sheets
FROM months
LEFT JOIN ppl ON ppl.m = months.m
LEFT JOIN ex ON ex.m = months.m
LEFT JOIN sh ON sh.m = months.m
ORDER BY months.m`;

// The newest teachers, scanner staff and students (the People panel).
const ADMIN_RECENT_PEOPLE_SQL = `
SELECT * FROM (
  SELECT u."userId", u."userName", u."emailId", u.status, u."profileUrl", u."createdAt", r.role,
         tp."teacherType", tp.specialization,
         sp."rollNumber", c."className", sec."sectionName",
         ROW_NUMBER() OVER (PARTITION BY r.role ORDER BY u."createdAt" DESC, u."userName") AS rn
  FROM viaexam_users u
  JOIN roles r ON r.id = u."roleId"
  LEFT JOIN viaexam_teacher_profiles tp ON tp."userId" = u."userId"
  LEFT JOIN viaexam_student_profiles sp ON sp."userId" = u."userId"
  LEFT JOIN viaexam_classes c ON c."classId" = sp."classId"
  LEFT JOIN viaexam_sections sec ON sec."sectionId" = sp."sectionId"
  WHERE u."instituteId" = :inst AND u."isDeleted" = false AND r.role IN ('TEACHER', 'SCANNER', 'STUDENT')
) x
WHERE rn <= 6
ORDER BY role, rn`;

const personRow = (x: any) => ({
  userId: x.userId,
  name: x.userName ?? "",
  email: x.emailId ?? "",
  photo: x.profileUrl ?? null,
  active: num(x.status) === 1,
  addedAt: x.createdAt,
  detail:
    x.role === "STUDENT"
      ? [x.className && `Class ${x.className}${x.sectionName ? `-${x.sectionName}` : ""}`, x.rollNumber && `Roll ${x.rollNumber}`].filter(Boolean).join(", ")
      : x.role === "TEACHER"
        ? [x.teacherType, x.specialization].filter(Boolean).join(", ")
        : "",
});

const loadAdminHome = async (instituteId: string) => {
  const crossCheck = (await settingsOf(instituteId)).crossCheck.mode !== "off";
  const r = { inst: instituteId, days: DAYS, approved: PAPER_APPROVED_STATUSES, withSetter: PAPER_WITH_SETTER, crossCheck };
  const [[s], daily, upcoming, approvals, paperSetting, rechecks, workload, trends, people] = await Promise.all([
    select(ADMIN_SUMMARY_SQL, r),
    select(ADMIN_DAILY_SQL, r),
    select(ADMIN_UPCOMING_SQL, r),
    select(ADMIN_APPROVALS_SQL, r),
    select(ADMIN_PAPER_SETTING_SQL, r),
    select(ADMIN_RECHECKS_SQL, r),
    select(ADMIN_WORKLOAD_SQL, r),
    select(ADMIN_TRENDS_SQL, r),
    select(ADMIN_RECENT_PEOPLE_SQL, r),
  ]);
  const recentOf = (role: string) => people.filter((x: any) => x.role === role).map(personRow);

  return {
    generatedAt: new Date().toISOString(),
    sessionName: s?.session_name ?? null,
    people: {
      students: num(s?.students),
      studentsThisMonth: num(s?.students_month),
      teachers: num(s?.teachers),
      scanners: num(s?.scanners),
      classes: num(s?.classes),
      sections: num(s?.sections),
      subjects: num(s?.subjects),
    },
    exams: { total: num(s?.total), today: num(s?.today), next7Days: num(s?.next7) },
    pipeline: {
      PAPER_PENDING: num(s?.paper_pending),
      READY_TO_SCAN: num(s?.ready_to_scan),
      SCANNING: num(s?.scanning),
      EVALUATING: num(s?.evaluating),
      CROSS_CHECK: num(s?.cross_check),
      REVIEWED: num(s?.reviewed),
      PUBLISHED: num(s?.published),
    },
    sheets: {
      total: num(s?.sheets_total),
      evaluated: num(s?.sheets_evaluated),
      pending: num(s?.sheets_pending),
      today: num(s?.sheets_today),
    },
    attention: {
      papersPending: num(s?.papers_pending),
      needsScanner: num(s?.ready_to_scan),
      needsEvaluator: num(s?.needs_evaluator),
      readyToPublish: num(s?.reviewed),
      crossCheckWaiting: num(s?.cross_check),
      rechecksPending: num(s?.rechecks_pending),
      failedEvaluations: num(s?.evaluations_failed),
      papersLate: num(s?.papers_late),
    },
    daily: series(daily),
    upcoming: upcoming.map((x: any) => ({ ...examRow(x), teacherName: x.teacherName ?? "" })),
    approvals: approvals.map((x: any) => ({
      ...examRow(x),
      paperId: x.paperId,
      paperSet: x.paperSet ?? null,
      teacherName: x.teacherName ?? "",
      submittedAt: x.submittedAt ?? null,
    })),
    paperSetting: {
      open: num(s?.papers_open),
      items: paperSetting.map((x: any) => ({ ...examRow(x), teacherId: x.teacherId ?? null, teacherName: x.teacherName ?? "" })),
    },
    rechecks: rechecks.map((x: any) => ({ ...examRow(x), requestId: x.requestId, studentName: x.studentName ?? "", requestedAt: x.createdAt })),
    workload: workload.map((x: any) => ({
      userId: x.userId,
      name: x.name ?? "",
      role: x.role === "SCANNER" ? "scanner" : x.role === "TEACHER" ? "teacher" : "staff",
      papers: num(x.papers),
      evaluations: num(x.evaluations),
      crossChecks: num(x.crossChecks),
      rechecks: num(x.rechecks),
      scans: num(x.scans),
      total: num(x.total),
    })),
    trends: trends.map((x: any) => ({
      month: x.month,
      students: num(x.students),
      teachers: num(x.teachers),
      scanners: num(x.scanners),
      exams: num(x.exams),
      sheets: num(x.sheets),
    })),
    recentPeople: { teachers: recentOf("TEACHER"), scanners: recentOf("SCANNER"), students: recentOf("STUDENT") },
  };
};

const getAdminHome = async (user: any) => {
  try {
    const instituteId = String(user?.instituteId ?? "");
    if (!instituteId) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for this user." };
    return ok("Admin home loaded.", await memoize(`home:admin:${instituteId}`, ADMIN_CACHE_MS, () => loadAdminHome(instituteId)));
  } catch (e) {
    return fail("admin", e);
  }
};

// ─── Setup checklist (master data in the order a new institute fills it in) ───

const SETUP_SQL = `
WITH cur AS (
  SELECT "sessionId", "sessionName" FROM viaexam_sessions
  WHERE "instituteId" = :inst AND "isDeleted" = false AND "isActive" = true
  ORDER BY "startDate" DESC NULLS LAST LIMIT 1
)
SELECT
  (SELECT COUNT(*) FROM viaexam_sessions WHERE "instituteId" = :inst AND "isDeleted" = false)::int AS sessions,
  (SELECT "sessionName" FROM cur) AS current_session,
  (SELECT COUNT(*) FROM viaexam_classes WHERE "instituteId" = :inst AND "isDeleted" = false)::int AS classes,
  (SELECT COUNT(*) FROM viaexam_classes c WHERE c."instituteId" = :inst AND c."isDeleted" = false
     AND NOT EXISTS (SELECT 1 FROM viaexam_sections s WHERE s."classId" = c."classId" AND s."isDeleted" = false))::int AS classes_without_sections,
  (SELECT COUNT(*) FROM viaexam_sections WHERE "instituteId" = :inst AND "isDeleted" = false)::int AS sections,
  (SELECT COUNT(*) FROM viaexam_classes c WHERE c."instituteId" = :inst AND c."isDeleted" = false
     AND NOT EXISTS (SELECT 1 FROM viaexam_subjects s WHERE s."classId" = c."classId" AND s."isDeleted" = false))::int AS classes_without_subjects,
  (SELECT COUNT(*) FROM viaexam_subjects WHERE "instituteId" = :inst AND "isDeleted" = false)::int AS subjects,
  (SELECT COUNT(DISTINCT ss."classId") FROM viaexam_session_sections ss WHERE ss."sessionId" = (SELECT "sessionId" FROM cur))::int AS classes_running,
  (SELECT COUNT(*) FROM viaexam_session_sections ss WHERE ss."sessionId" = (SELECT "sessionId" FROM cur) AND ss."classTeacherId" IS NULL)::int AS sections_without_teacher,
  (SELECT COUNT(*) FROM viaexam_session_subjects ss WHERE ss."sessionId" = (SELECT "sessionId" FROM cur))::int AS subjects_running,
  (SELECT COUNT(*) FROM viaexam_session_subjects ss WHERE ss."sessionId" = (SELECT "sessionId" FROM cur) AND ss."teacherId" IS NULL)::int AS subjects_without_teacher,
  (SELECT COUNT(*) FROM viaexam_users u JOIN roles r ON r.id = u."roleId"
     WHERE u."instituteId" = :inst AND u."isDeleted" = false AND u.status = 1 AND r.role = 'TEACHER')::int AS teachers,
  (SELECT COUNT(*) FROM viaexam_users u JOIN roles r ON r.id = u."roleId"
     WHERE u."instituteId" = :inst AND u."isDeleted" = false AND u.status = 1 AND r.role = 'SCANNER')::int AS scanners,
  (SELECT COUNT(*) FROM viaexam_student_enrollments e JOIN viaexam_users u ON u."userId" = e."studentId" AND u.status = 1
     WHERE e."sessionId" = (SELECT "sessionId" FROM cur) AND e."isActive" = true)::int AS students_current,
  (SELECT COUNT(*) FROM viaexam_exams WHERE "instituteId" = :inst AND "isDeleted" = false
     AND "sessionId" = (SELECT "sessionId" FROM cur))::int AS exams_current`;

const loadSetup = async (instituteId: string) => {
  const [s] = await select(SETUP_SQL, { inst: instituteId });
  const n = (k: string) => num(s?.[k]);
  const steps = [
    { key: "session", label: "Academic session", done: Boolean(s?.current_session), count: n("sessions"), detail: s?.current_session ? `Current: ${s.current_session}` : "Create the session and set it as current" },
    { key: "classes", label: "Classes", done: n("classes") > 0, count: n("classes"), detail: n("classes") ? `${n("classes")} classes` : "Add the classes you teach" },
    { key: "sections", label: "Sections", done: n("classes") > 0 && n("classes_without_sections") === 0, count: n("sections"), detail: n("classes_without_sections") ? `${n("classes_without_sections")} classes have no sections` : `${n("sections")} sections` },
    { key: "subjects", label: "Subjects", done: n("classes") > 0 && n("classes_without_subjects") === 0, count: n("subjects"), detail: n("classes_without_subjects") ? `${n("classes_without_subjects")} classes have no subjects` : `${n("subjects")} subjects` },
    {
      key: "setup",
      label: "Session setup",
      done: n("classes_running") > 0,
      count: n("classes_running"),
      detail: !s?.current_session
        ? "Set a current session first"
        : n("classes_running")
          ? `${n("classes_running")} classes in ${s.current_session}${n("sections_without_teacher") ? ` · ${n("sections_without_teacher")} sections without a class teacher` : ""}`
          : `Choose the classes and subjects of ${s.current_session}`,
    },
    { key: "teachers", label: "Teachers", done: n("teachers") > 0, count: n("teachers"), detail: n("teachers") ? `${n("teachers")} teachers` : "Add teachers with their subjects" },
    {
      key: "subjectTeachers",
      label: "Subject teachers",
      done: n("subjects_running") > 0 && n("subjects_without_teacher") === 0,
      count: n("subjects_running") - n("subjects_without_teacher"),
      detail: n("subjects_without_teacher") ? `${n("subjects_without_teacher")} subjects have no teacher this session` : n("subjects_running") ? "Every subject has a teacher" : "No subjects in this session yet",
    },
    { key: "students", label: "Students", done: n("students_current") > 0, count: n("students_current"), detail: s?.current_session ? `${n("students_current")} in ${s.current_session}` : "Set a current session first" },
    { key: "scanners", label: "Scanner staff", done: n("scanners") > 0, count: n("scanners"), detail: n("scanners") ? `${n("scanners")} scanner staff` : "Add staff who upload answer sheets" },
    { key: "exams", label: "First exam", done: n("exams_current") > 0, count: n("exams_current"), detail: n("exams_current") ? `${n("exams_current")} exams this session` : "Create a Mid Term or Final exam" },
  ];
  return { currentSession: s?.current_session ?? null, steps, done: steps.filter((x) => x.done).length, total: steps.length };
};

const getSetupStatus = async (user: any) => {
  try {
    const instituteId = String(user?.instituteId ?? "");
    return ok("Setup status loaded.", await memoize(`home:setup:${instituteId}`, 10_000, () => loadSetup(instituteId)));
  } catch (e) {
    return fail("setup", e);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// TEACHER — papers to set, evaluations, cross-checks, rechecks
// ═════════════════════════════════════════════════════════════════════════════

const TEACHER_SUMMARY_SQL = `
WITH my AS (SELECT status FROM viaexam_exams WHERE "instituteId" = :inst AND "teacherId" = :uid AND "isDeleted" = false),
ev AS (SELECT "reviewedAt" FROM viaexam_evaluation_assignments WHERE "instituteId" = :inst AND "teacherId" = :uid AND "isActive" = true),
rc AS (SELECT "completedAt" FROM viaexam_recheck_assignments WHERE "instituteId" = :inst AND "teacherId" = :uid)
SELECT
  (SELECT COUNT(*) FROM my)::int AS papers_total,
  (SELECT COUNT(*) FROM my WHERE status IN ('Draft', 'Paper Created'))::int AS to_prepare,
  (SELECT COUNT(*) FROM my WHERE status = 'Rejected')::int AS rejected,
  (SELECT COUNT(*) FROM my WHERE status = 'Pending Approval')::int AS pending_approval,
  (SELECT COUNT(*) FROM my WHERE status IN (:approved))::int AS approved,
  (SELECT COUNT(*) FROM ev WHERE "reviewedAt" IS NULL)::int AS eval_open,
  (SELECT COUNT(*) FROM ev WHERE "reviewedAt" IS NOT NULL)::int AS eval_reviewed,
  (SELECT COUNT(*) FROM rc WHERE "completedAt" IS NULL)::int AS recheck_open,
  (SELECT COUNT(*) FROM rc WHERE "completedAt" IS NOT NULL)::int AS recheck_done,
  (SELECT COUNT(*) FROM viaexam_cross_check_rounds
    WHERE "instituteId" = :inst AND "checkerId" = :uid AND "isActive" = true AND status = 'open')::int AS cross_check_open,
  (SELECT COUNT(*) FROM viaexam_subjects WHERE "instituteId" = :inst AND "teacherId" = :uid AND "isDeleted" = false)::int AS subjects,
  (SELECT COUNT(DISTINCT "classId") FROM viaexam_subjects WHERE "instituteId" = :inst AND "teacherId" = :uid AND "isDeleted" = false)::int AS classes`;

// Everything waiting on this teacher, most blocking first, then by exam date.
const TEACHER_TASKS_SQL = `
SELECT t.* FROM (
  SELECT CASE WHEN e.status = 'Rejected' THEN 'FIX_PAPER' ELSE 'SET_PAPER' END AS kind,
         NULL::varchar AS "requestId", NULL::timestamptz AS "assignedAt", ${EXAM_COLUMNS}
  FROM viaexam_exams e
  ${EXAM_NAMES}
  WHERE e."instituteId" = :inst AND e."teacherId" = :uid AND e."isDeleted" = false
    AND e.status IN ('Draft', 'Paper Created', 'Rejected')
  UNION ALL
  SELECT 'EVALUATE', NULL, a."createdAt", ${EXAM_COLUMNS}
  FROM viaexam_evaluation_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false
  ${EXAM_NAMES}
  WHERE a."instituteId" = :inst AND a."teacherId" = :uid AND a."isActive" = true AND a."reviewedAt" IS NULL
  UNION ALL
  SELECT 'RECHECK', ra."requestId", ra."assignedAt", ${EXAM_COLUMNS}
  FROM viaexam_recheck_assignments ra
  JOIN viaexam_exams e ON e."examId" = ra."examId"
  ${EXAM_NAMES}
  WHERE ra."instituteId" = :inst AND ra."teacherId" = :uid AND ra."completedAt" IS NULL
  UNION ALL
  SELECT 'CROSS_CHECK', NULL, r."createdAt", ${EXAM_COLUMNS}
  FROM viaexam_cross_check_rounds r
  JOIN viaexam_exams e ON e."examId" = r."examId" AND e."isDeleted" = false
  ${EXAM_NAMES}
  WHERE r."instituteId" = :inst AND r."checkerId" = :uid AND r."isActive" = true AND r.status = 'open'
) t
ORDER BY CASE t.kind WHEN 'FIX_PAPER' THEN 0 WHEN 'RECHECK' THEN 1 WHEN 'CROSS_CHECK' THEN 2 WHEN 'EVALUATE' THEN 3 ELSE 4 END,
         t."examDate" NULLS LAST, t."assignedAt" NULLS LAST
LIMIT 10`;

const TEACHER_UPCOMING_SQL = `
SELECT ${EXAM_COLUMNS},
       (e."teacherId" = :uid) AS "isPaperSetter",
       EXISTS (SELECT 1 FROM viaexam_evaluation_assignments a
               WHERE a."examId" = e."examId" AND a."teacherId" = :uid AND a."isActive" = true) AS "isEvaluator"
FROM viaexam_exams e
${EXAM_NAMES}
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."examDate" >= ${TODAY}
  AND (e."teacherId" = :uid
       OR e."subjectId" IN (SELECT "subjectId" FROM viaexam_subjects WHERE "instituteId" = :inst AND "teacherId" = :uid AND "isDeleted" = false)
       OR e."examId" IN (SELECT "examId" FROM viaexam_evaluation_assignments WHERE "teacherId" = :uid AND "isActive" = true))
ORDER BY e."examDate", e."examTime" NULLS LAST
LIMIT 6`;

const OPEN_EVALUATIONS_SQL = `
SELECT a."examId", a."createdAt" AS "assignedAt"
FROM viaexam_evaluation_assignments a
JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false
WHERE a."instituteId" = :inst AND a."teacherId" = :uid AND a."isActive" = true AND a."reviewedAt" IS NULL
ORDER BY e."examDate" NULLS LAST, a."createdAt"
LIMIT 4`;

/** Roster numbers (uploaded / evaluated) of a few exams — same counting as the evaluation pages. */
const progressOf = async (instituteId: string, examIds: string[]) => {
  const exams = await Promise.all(examIds.map((id) => loadExam(instituteId, id)));
  return Promise.all(
    exams.filter(Boolean).map(async (exam: any) => {
      const { counts } = await buildRoster(exam);
      return {
        examId: exam.examId,
        examType: exam.examType ?? "",
        examDate: exam.examDate ?? null,
        className: exam.class?.className ?? "",
        sectionName: exam.section?.sectionName ?? "",
        subjectName: exam.subject?.subjectName ?? "",
        counts,
      };
    })
  );
};

const loadTeacherHome = async (instituteId: string, userId: string) => {
  const r = { inst: instituteId, uid: userId, approved: PAPER_APPROVED_STATUSES };
  const [[s], tasks, upcoming, open] = await Promise.all([
    select(TEACHER_SUMMARY_SQL, r),
    select(TEACHER_TASKS_SQL, r),
    select(TEACHER_UPCOMING_SQL, r),
    select<{ examId: string; assignedAt: string }>(OPEN_EVALUATIONS_SQL, r),
  ]);
  const progress = await progressOf(instituteId, open.map((o) => o.examId));
  const assignedAt = new Map(open.map((o) => [o.examId, o.assignedAt]));

  return {
    generatedAt: new Date().toISOString(),
    papers: {
      total: num(s?.papers_total),
      toPrepare: num(s?.to_prepare),
      rejected: num(s?.rejected),
      pendingApproval: num(s?.pending_approval),
      approved: num(s?.approved),
    },
    evaluations: { open: num(s?.eval_open), reviewed: num(s?.eval_reviewed) },
    rechecks: { open: num(s?.recheck_open), done: num(s?.recheck_done) },
    crossChecks: { open: num(s?.cross_check_open) },
    teaching: { subjects: num(s?.subjects), classes: num(s?.classes) },
    tasks: tasks.map((x: any) => ({ ...examRow(x), kind: x.kind, requestId: x.requestId ?? null, assignedAt: x.assignedAt ?? null })),
    evaluationProgress: progress.map((p) => ({ ...p, assignedAt: assignedAt.get(p.examId) ?? null })),
    upcoming: upcoming.map((x: any) => ({ ...examRow(x), isPaperSetter: Boolean(x.isPaperSetter), isEvaluator: Boolean(x.isEvaluator) })),
  };
};

const getTeacherHome = async (user: any) => {
  try {
    const instituteId = String(user?.instituteId ?? "");
    const userId = String(user?.userId ?? "");
    return ok(
      "Teacher home loaded.",
      await memoize(`home:teacher:${instituteId}:${userId}`, USER_CACHE_MS, () => loadTeacherHome(instituteId, userId))
    );
  } catch (e) {
    return fail("teacher", e);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SCANNER — assigned exams and own uploads
// ═════════════════════════════════════════════════════════════════════════════

const SCANNER_SUMMARY_SQL = `
SELECT
  (SELECT COUNT(*) FROM viaexam_exam_scanner_assignments
    WHERE "instituteId" = :inst AND "scannerId" = :uid AND "isActive" = true AND status = 'ASSIGNED')::int AS open,
  (SELECT COUNT(*) FROM viaexam_exam_scanner_assignments
    WHERE "instituteId" = :inst AND "scannerId" = :uid AND "isActive" = true AND status = 'COMPLETED')::int AS completed,
  (SELECT COUNT(*) FROM viaexam_exam_attendance
    WHERE "instituteId" = :inst AND "markedBy" = :uid AND status = 'ABSENT')::int AS absent_marked,
  u.*
FROM (
  SELECT COUNT(*)::int AS uploads_total,
         COUNT(*) FILTER (WHERE "createdAt" >= (date_trunc('day', now() AT TIME ZONE :tz) AT TIME ZONE :tz))::int AS uploads_today,
         COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days')::int AS uploads_7d
  FROM viaexam_answer_sheets
  WHERE "instituteId" = :inst AND "uploadedBy" = :uid AND "isDeleted" = false
) u`;

const SCANNER_DAILY_SQL = `
WITH days AS (${DAY_SERIES}),
up AS (
  SELECT (s."createdAt" AT TIME ZONE :tz)::date AS day, COUNT(*)::int AS n
  FROM viaexam_answer_sheets s
  WHERE s."instituteId" = :inst AND s."uploadedBy" = :uid AND s."isDeleted" = false AND s."createdAt" >= ${SERIES_START}
  GROUP BY 1
)
SELECT to_char(days.day, 'YYYY-MM-DD') AS day, COALESCE(up.n, 0) AS uploaded, 0 AS evaluated
FROM days LEFT JOIN up ON up.day = days.day
ORDER BY days.day`;

const SCANNER_RECENT_SQL = `
SELECT s."sheetId", s."rollNo", s."studentName", s."createdAt", s."examType",
       COALESCE(c."className", s."classId") AS "className", s.section AS "sectionName", sub."subjectName",
       ev.status AS "evaluationStatus"
FROM viaexam_answer_sheets s
LEFT JOIN viaexam_classes c ON c."classId" = s."classId"
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = s."subjectId"
LEFT JOIN viaexam_ai_evaluations ev ON ev."sheetId" = s."sheetId"
WHERE s."instituteId" = :inst AND s."uploadedBy" = :uid AND s."isDeleted" = false
ORDER BY s."createdAt" DESC
LIMIT 6`;

const loadScannerHome = async (user: any) => {
  const r = { inst: String(user.instituteId), uid: String(user.userId), days: DAYS };
  const [[s], daily, recent, assigned] = await Promise.all([
    select(SCANNER_SUMMARY_SQL, r),
    select(SCANNER_DAILY_SQL, r),
    select(SCANNER_RECENT_SQL, r),
    ExamWorkflowService.myScanExams(user, { status: "ASSIGNED", limit: 6 }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    assignments: { open: num(s?.open), completed: num(s?.completed) },
    uploads: { total: num(s?.uploads_total), today: num(s?.uploads_today), last7Days: num(s?.uploads_7d) },
    absentMarked: num(s?.absent_marked),
    daily: series(daily),
    assignedExams: assigned.exams,
    recentUploads: recent.map((x: any) => ({
      sheetId: x.sheetId,
      rollNo: x.rollNo ?? "",
      studentName: x.studentName ?? "",
      examType: x.examType ?? "",
      className: x.className ?? "",
      sectionName: x.sectionName ?? "",
      subjectName: x.subjectName ?? "",
      evaluationStatus: x.evaluationStatus ?? null,
      uploadedAt: x.createdAt,
    })),
  };
};

const getScannerHome = async (user: any) => {
  try {
    const key = `home:scanner:${user?.instituteId}:${user?.userId}`;
    return ok("Scanner home loaded.", await memoize(key, USER_CACHE_MS, () => loadScannerHome(user)));
  } catch (e) {
    return fail("scanner", e);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// STUDENT — timetable, published results, rechecks
// ═════════════════════════════════════════════════════════════════════════════

// The student's current enrolment: the current session's, else their latest.
const STUDENT_PROFILE_SQL = `
SELECT e."rollNumber", se."sessionName", e."sessionId", e."classId",
       COALESCE(c."className", '') AS "className", sec."sectionName", e."sectionId"
FROM viaexam_student_enrollments e
JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
WHERE e."studentId" = :uid AND e."instituteId" = :inst
ORDER BY se."isActive" DESC, se."startDate" DESC
LIMIT 1`;

const STUDENT_UPCOMING_SQL = `
SELECT ${EXAM_COLUMNS}, e.duration, e."totalMarks"
FROM viaexam_exams e
${EXAM_NAMES}
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."examDate" >= ${TODAY}
  AND e."classId" = :classId AND e."sessionId" = :sessionId
  AND (e."sectionId" IS NULL OR e."sectionId" = '' OR e."sectionId" IN (:sectionKeys) OR sec."sectionName" IN (:sectionKeys))
ORDER BY e."examDate", e."examTime" NULLS LAST
LIMIT 6`;

const STUDENT_RESULTS_SQL = `
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE "resultStatus" = 'PASS')::int AS passed,
       COUNT(*) FILTER (WHERE "resultStatus" = 'FAIL')::int AS failed,
       COUNT(*) FILTER (WHERE "resultStatus" = 'ABSENT')::int AS absent,
       AVG(percentage) FILTER (WHERE "resultStatus" IN ('PASS', 'FAIL')) AS average,
       MAX(percentage) FILTER (WHERE "resultStatus" IN ('PASS', 'FAIL')) AS best,
       (SELECT COUNT(*) FROM viaexam_recheck_requests
         WHERE "studentId" = :uid AND "instituteId" = :inst AND status IN ('Pending', 'Under Review', 'Approved'))::int AS rechecks_open,
       (SELECT COUNT(*) FROM viaexam_recheck_requests
         WHERE "studentId" = :uid AND "instituteId" = :inst AND status IN ('Completed', 'Rejected'))::int AS rechecks_closed
FROM viaexam_student_results
WHERE "studentId" = :uid AND "instituteId" = :inst AND "isDeleted" = false`;

const STUDENT_LATEST_SQL = `
SELECT r."resultId", r."examId", r."examType", r."marksObtained", r."totalMarks", r.percentage, r.grade,
       r."resultStatus", r."publishedAt", sub."subjectName", rr.status AS "recheckStatus"
FROM viaexam_student_results r
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = r."subjectId"
LEFT JOIN viaexam_recheck_requests rr ON rr."examId" = r."examId" AND rr."studentId" = r."studentId"
WHERE r."studentId" = :uid AND r."instituteId" = :inst AND r."isDeleted" = false
ORDER BY r."publishedAt" DESC
LIMIT 6`;

const STUDENT_SUBJECTS_SQL = `
SELECT COALESCE(sub."subjectName", 'Subject') AS "subjectName", AVG(r.percentage) AS average, COUNT(*)::int AS exams
FROM viaexam_student_results r
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = r."subjectId"
WHERE r."studentId" = :uid AND r."instituteId" = :inst AND r."isDeleted" = false AND r."resultStatus" IN ('PASS', 'FAIL')
GROUP BY 1
ORDER BY 2 DESC
LIMIT 8`;

const STUDENT_RECHECKS_SQL = `
SELECT rr."requestId", rr.status, rr."createdAt", rr."completedAt", sub."subjectName", e."examType"
FROM viaexam_recheck_requests rr
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = rr."subjectId"
LEFT JOIN viaexam_exams e ON e."examId" = rr."examId"
WHERE rr."studentId" = :uid AND rr."instituteId" = :inst
ORDER BY rr."createdAt" DESC
LIMIT 4`;

const loadStudentHome = async (instituteId: string, userId: string) => {
  const r = { inst: instituteId, uid: userId };
  const [[profile], [s], latest, subjects, rechecks] = await Promise.all([
    select(STUDENT_PROFILE_SQL, r),
    select(STUDENT_RESULTS_SQL, r),
    select(STUDENT_LATEST_SQL, r),
    select(STUDENT_SUBJECTS_SQL, r),
    select(STUDENT_RECHECKS_SQL, r),
  ]);

  // Section keys: the id and the name, since older exams / profiles store either one.
  const sectionKeys = [profile?.sectionId, profile?.sectionName].filter(Boolean);
  const upcoming = profile?.classId
    ? await select(STUDENT_UPCOMING_SQL, { ...r, classId: profile.classId, sessionId: profile.sessionId, sectionKeys: sectionKeys.length ? sectionKeys : [""] })
    : [];

  return {
    generatedAt: new Date().toISOString(),
    profile: {
      className: profile?.className ?? "",
      sectionName: profile?.sectionName ?? "",
      rollNumber: profile?.rollNumber ?? "",
      sessionName: profile?.sessionName ?? "",
    },
    results: {
      total: num(s?.total),
      passed: num(s?.passed),
      failed: num(s?.failed),
      absent: num(s?.absent),
      average: pctOrNull(s?.average),
      best: pctOrNull(s?.best),
    },
    rechecks: { open: num(s?.rechecks_open), closed: num(s?.rechecks_closed) },
    upcoming: upcoming.map((x: any) => ({ ...examRow(x), duration: x.duration ?? null, totalMarks: x.totalMarks ?? null })),
    latestResults: latest.map((x: any) => ({
      resultId: x.resultId,
      examId: x.examId,
      examType: x.examType ?? "",
      subjectName: x.subjectName ?? "",
      marksObtained: x.marksObtained == null ? null : Number(x.marksObtained),
      totalMarks: num(x.totalMarks),
      percentage: pctOrNull(x.percentage),
      grade: x.grade ?? null,
      resultStatus: x.resultStatus,
      publishedAt: x.publishedAt,
      recheckStatus: x.recheckStatus ?? null,
    })),
    subjects: subjects.map((x: any) => ({ subjectName: x.subjectName, average: pctOrNull(x.average) ?? 0, exams: num(x.exams) })),
    recentRechecks: rechecks.map((x: any) => ({
      requestId: x.requestId,
      status: x.status,
      subjectName: x.subjectName ?? "",
      examType: x.examType ?? "",
      requestedAt: x.createdAt,
      completedAt: x.completedAt ?? null,
    })),
  };
};

const getStudentHome = async (user: any) => {
  try {
    const instituteId = String(user?.instituteId ?? "");
    const userId = String(user?.userId ?? "");
    return ok(
      "Student home loaded.",
      await memoize(`home:student:${instituteId}:${userId}`, USER_CACHE_MS, () => loadStudentHome(instituteId, userId))
    );
  } catch (e) {
    return fail("student", e);
  }
};

export default { getAdminHome, getSetupStatus, getTeacherHome, getScannerHome, getStudentHome };
