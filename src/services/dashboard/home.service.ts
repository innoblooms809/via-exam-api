import { settingsOf } from "../academic/instituteSettings.service";
import { activeSession, openSessionIds } from "../academic/sessionSetup.service";
import httpStatus from "http-status";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import { memoize } from "../../utils/memoCache";
import { buildRoster, loadExam } from "../exam/examRoster.service";
import ExamWorkflowService, { PAPER_APPROVED_STATUSES } from "../exam/examWorkflow.service";
import { maskName } from "../evaluation/evaluationAccess.service";

// Home pages of the institute roles (admin, teacher, scanner, student). Each page is
// one request: a few aggregate SQL statements run in parallel, nothing is loaded into
// Node just to be counted. Results are cached briefly per institute / per user, so a
// page refresh or a second tab costs nothing.
// The teacher, scanner and student pages show the school's current session only (the one
// the admin set as current) and say which it is; the admin's page shows the session asked for.
//
// Exam stages follow examWorkflow.stageOf(); the only approximation is that an exam
// without a scanner counts as "scanning" once any sheet tagged with it is uploaded
// (the workflow page decides "scan finished" from the full roster). When the school
// cross-checks the exam's subject, a reviewed exam waits in CROSS_CHECK until its round is done.

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

/** A session as the home pages name it. */
type HomeSession = { sessionId: string; sessionName: string };

/**
 * The school's current session: the one the admin set as current. The teacher, scanner and
 * student home pages show its work only; null when the admin hasn't set one (the pages are
 * then empty). Cached briefly, so switching the current session shows within seconds.
 */
const currentSessionOf = (instituteId: string) =>
  memoize<HomeSession | null>(`home:current-session:${instituteId}`, 10_000, async () => {
    const s = await activeSession(instituteId);
    return s ? { sessionId: s.sessionId, sessionName: s.sessionName } : null;
  });

// Shared SQL fragments ─────────────────────────────────────────────────────────

const TODAY = `(now() AT TIME ZONE :tz)::date`;
// First instant of the day (DAYS - 1) days ago, in the institute's time zone.
const SERIES_START = `((date_trunc('day', now() AT TIME ZONE :tz) - (:days - 1) * interval '1 day') AT TIME ZONE :tz)`;
const DAY_SERIES = `SELECT generate_series(${TODAY} - (:days - 1), ${TODAY}, interval '1 day')::date AS day`;

/** Exam statuses while its paper is with the setter: not started, being written, sent back. */
const PAPER_WITH_SETTER = ["Draft", "Paper Created", "Rejected"];
/** A question paper is due this many days before its exam; still with its setter after that, it is overdue. */
const PAPER_DUE_DAYS = 14;

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
//
// Numbers and analytics follow one session, the current one (every session when none is
// current): exams, answer sheets, students enrolled, classes running. Teachers and scanner
// staff are the school's (nobody is hired per session).
// Needs attention counts the session shown: every kind of admin exam work, from question
// paper approvals to results and rechecks. The waiting lists (approvals, rechecks) show every
// session, so nothing drops off the page when a new session becomes current; rows of
// another session carry its name.

const ALL_SESSIONS = "all";

/** Exam `e` is in the session shown (:ses = '' for every session). */
const IN_SCOPE = `(:ses = '' OR e."sessionId" = :ses)`;
/** Exam `e` is in a session that hasn't ended: the current one and any later one (:open is never empty). */
const IN_OPEN = `e."sessionId" IN (:open)`;

/** Each exam's stage (as examWorkflow.stageOf) for the exams of a CTE `ex`, as `st`. */
const EXAM_STAGES = `
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
  SELECT ex."examId", ex."sessionId", ex."examDate", ex.status, ex."teacherId" IS NOT NULL AS has_setter,
         CASE
           WHEN pub."examId" IS NOT NULL THEN 'PUBLISHED'
           WHEN ex.status NOT IN (:approved) THEN 'PAPER_PENDING'
           WHEN ev."reviewedAt" IS NOT NULL AND :crossCheck AND (:ccAllSubjects OR ex."subjectId" IN (:ccSubjects)) AND (xr."examId" IS NULL OR xr.pending > 0) THEN 'CROSS_CHECK'
           WHEN ev."reviewedAt" IS NOT NULL THEN 'REVIEWED'
           WHEN sc.status = 'COMPLETED' THEN 'EVALUATING'
           WHEN sc."examId" IS NOT NULL OR up."examId" IS NOT NULL THEN 'SCANNING'
           ELSE 'READY_TO_SCAN'
         END AS stage,
         ex.status IN (:approved) AS approved,
         sc.status AS scan_status,
         up."examId" IS NOT NULL AS has_sheets,
         ev."examId" IS NOT NULL AS has_evaluator
  FROM ex
  LEFT JOIN pub ON pub."examId" = ex."examId"
  LEFT JOIN sc ON sc."examId" = ex."examId"
  LEFT JOIN ev ON ev."examId" = ex."examId"
  LEFT JOIN up ON up."examId" = ex."examId"
  LEFT JOIN xr ON xr."examId" = ex."examId"
)`;

/**
 * The day of an exam without a date of its own: the first day the date sheet gives its paper
 * (same session or none, class, subject and exam type), as the Exam calendar shows it.
 */
const EXAM_DAY = `
exam_day AS (
  SELECT e."examId", MIN(ac."eventDate") AS day
  FROM viaexam_exams e
  JOIN viaexam_academic_calendar ac
    ON ac."instituteId" = e."instituteId" AND ac."isDeleted" = false
   AND ac."classId" = e."classId" AND ac."subjectId" = e."subjectId"
   AND (ac."sessionId" = e."sessionId" OR ac."sessionId" IS NULL)
   AND regexp_replace(lower(ac."eventType"), '[^a-z0-9]', '', 'g') = regexp_replace(lower(e."examType"), '[^a-z0-9]', '', 'g')
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."examDate" IS NULL
  GROUP BY e."examId"
)`;
/** An exam's day: its own date, else the date sheet's. */
const DAY_OF_EXAM = `COALESCE(e."examDate", exam_day.day)`;

/** Session columns and join for an exam row `e`. */
const EXAM_SESSION_COLUMNS = `e."sessionId", sx."sessionName"`;
const EXAM_SESSION = `LEFT JOIN viaexam_sessions sx ON sx."sessionId" = e."sessionId"`;

// The numbers of the session shown.
const ADMIN_SUMMARY_SQL = `
WITH b AS (SELECT (date_trunc('month', now() AT TIME ZONE :tz) AT TIME ZONE :tz) AS m0),
${EXAM_DAY},
ex AS (
  SELECT e."examId", e."sessionId", e."subjectId", e.status, ${DAY_OF_EXAM} AS "examDate", e."teacherId"
  FROM viaexam_exams e
  LEFT JOIN exam_day ON exam_day."examId" = e."examId"
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND ${IN_SCOPE}
),
${EXAM_STAGES},
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
         -- Question paper (and model answer) of each exam, as its setter has it.
         COUNT(*) FILTER (WHERE status = 'Paper Created')::int AS qp_writing,
         COUNT(*) FILTER (WHERE status = 'Rejected')::int AS qp_sent_back,
         COUNT(*) FILTER (WHERE status = 'Pending Approval')::int AS qp_waiting,
         COUNT(*) FILTER (WHERE approved)::int AS qp_approved,
         -- Scanning of the exams whose question paper is approved.
         COUNT(*) FILTER (WHERE approved AND scan_status IS NULL AND NOT has_sheets)::int AS scan_none,
         COUNT(*) FILTER (WHERE approved AND scan_status IS NOT NULL AND scan_status <> 'COMPLETED' AND NOT has_sheets)::int AS scan_assigned,
         COUNT(*) FILTER (WHERE approved AND has_sheets AND scan_status IS DISTINCT FROM 'COMPLETED')::int AS scan_uploading,
         COUNT(*) FILTER (WHERE approved AND scan_status = 'COMPLETED')::int AS scan_completed
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
-- Students enrolled in the session (every active student when no session is shown).
enr AS (
  SELECT COUNT(DISTINCT en."studentId")::int AS students
  FROM viaexam_student_enrollments en
  JOIN viaexam_users u ON u."userId" = en."studentId" AND u."isDeleted" = false AND u.status = 1
  WHERE en."instituteId" = :inst AND en."isActive" = true AND en."sessionId" = :ses
),
-- Classes, sections and subjects running in the session (master data when no session is shown).
aca AS (
  SELECT CASE WHEN :ses = '' THEN (SELECT COUNT(*) FROM viaexam_classes WHERE "instituteId" = :inst AND "isDeleted" = false)
              ELSE (SELECT COUNT(DISTINCT ss."classId") FROM viaexam_session_sections ss
                    JOIN viaexam_classes c ON c."classId" = ss."classId" AND c."isDeleted" = false WHERE ss."sessionId" = :ses) END::int AS classes,
         CASE WHEN :ses = '' THEN (SELECT COUNT(*) FROM viaexam_sections WHERE "instituteId" = :inst AND "isDeleted" = false)
              ELSE (SELECT COUNT(*) FROM viaexam_session_sections ss
                    JOIN viaexam_sections s ON s."sectionId" = ss."sectionId" AND s."isDeleted" = false WHERE ss."sessionId" = :ses) END::int AS sections,
         CASE WHEN :ses = '' THEN (SELECT COUNT(*) FROM viaexam_subjects WHERE "instituteId" = :inst AND "isDeleted" = false)
              ELSE (SELECT COUNT(*) FROM viaexam_session_subjects ss
                    JOIN viaexam_subjects s ON s."subjectId" = ss."subjectId" AND s."isDeleted" = false WHERE ss."sessionId" = :ses) END::int AS subjects
),
-- Student answer sheets of the session's exams.
sht AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE s.status IN ('Evaluated', 'Processed'))::int AS evaluated,
         COUNT(*) FILTER (WHERE s.status = 'Pending')::int AS pending,
         COUNT(*) FILTER (WHERE s."createdAt" >= (date_trunc('day', now() AT TIME ZONE :tz) AT TIME ZONE :tz))::int AS today
  FROM viaexam_answer_sheets s
  WHERE s."instituteId" = :inst AND s."isDeleted" = false AND (:ses = '' OR s."examId" IN (SELECT "examId" FROM ex))
)
SELECT stage.*, ppl.teachers, ppl.scanners, ppl.students_month, aca.*,
       CASE WHEN :ses = '' THEN ppl.students ELSE enr.students END AS students,
       sht.total AS sheets_total, sht.evaluated AS sheets_evaluated, sht.pending AS sheets_pending, sht.today AS sheets_today
FROM stage, ppl, enr, aca, sht`;

// Open work of every session, one row per session (sessionId null: answer sheets the AI
// failed that aren't linked to an exam). Node picks what counts where (see loadAdminHome).
const ADMIN_OPEN_WORK_SQL = `
WITH ${EXAM_DAY},
ex AS (
  SELECT e."examId", e."sessionId", e."subjectId", e.status, ${DAY_OF_EXAM} AS "examDate", e."teacherId"
  FROM viaexam_exams e
  LEFT JOIN exam_day ON exam_day."examId" = e."examId"
  WHERE e."instituteId" = :inst AND e."isDeleted" = false
),
${EXAM_STAGES},
stg AS (
  SELECT "sessionId",
         COUNT(*) FILTER (WHERE stage = 'REVIEWED')::int AS ready,
         COUNT(*) FILTER (WHERE stage = 'CROSS_CHECK')::int AS cross_check,
         -- Answer sheets are coming in, or the exam is over, and nobody evaluates it.
         COUNT(*) FILTER (WHERE NOT has_evaluator AND stage IN ('SCANNING', 'EVALUATING'))::int AS no_evaluator_sheets,
         COUNT(*) FILTER (WHERE NOT has_evaluator AND stage = 'READY_TO_SCAN' AND "examDate" <= ${TODAY})::int AS no_evaluator_due,
         -- The exam is over, its paper approved, and nobody uploads the answer sheets.
         COUNT(*) FILTER (WHERE stage = 'READY_TO_SCAN' AND "examDate" <= ${TODAY})::int AS no_scanner,
         -- Question papers still with their setters when the exam is PAPER_DUE_DAYS away or less (or past): overdue.
         COUNT(*) FILTER (WHERE status IN (:withSetter))::int AS with_setter,
         COUNT(*) FILTER (WHERE status IN (:withSetter) AND "examDate" <= ${TODAY} + ${PAPER_DUE_DAYS})::int AS overdue,
         -- Nobody is set to write the question paper.
         COUNT(*) FILTER (WHERE status IN (:withSetter) AND NOT has_setter)::int AS no_setter,
         -- Not on the date sheet (and no date of its own), with the result still to come.
         COUNT(*) FILTER (WHERE "examDate" IS NULL AND stage <> 'PUBLISHED')::int AS no_date
  FROM st
  GROUP BY 1
),
-- A question paper and its model answer are sent, and approved, together.
qp AS (
  SELECT ex."sessionId", COUNT(*)::int AS n
  FROM viaexam_question_papers q
  JOIN ex ON ex."examId" = q."examId"
  WHERE q."instituteId" = :inst AND q.status = 'PENDING_APPROVAL' AND q."deletedAt" IS NULL
  GROUP BY 1
),
rr AS (
  SELECT ex."sessionId", COUNT(*)::int AS n
  FROM viaexam_recheck_requests r
  JOIN ex ON ex."examId" = r."examId"
  WHERE r."instituteId" = :inst AND r.status = 'Pending'
  GROUP BY 1
),
-- Answer sheets the AI couldn't mark (one evaluation per sheet).
fl AS (
  SELECT ex."sessionId", COUNT(*)::int AS n
  FROM viaexam_ai_evaluations a
  JOIN viaexam_answer_sheets s ON s."sheetId" = a."sheetId" AND s."isDeleted" = false
  LEFT JOIN ex ON ex."examId" = COALESCE(NULLIF(s."examId", ''), NULLIF(a."examId", ''))
  WHERE s."instituteId" = :inst AND a.status = 'Failed'
  GROUP BY 1
),
-- Scanners asking to re-open an upload they marked complete.
ro AS (
  SELECT ex."sessionId", COUNT(*)::int AS n
  FROM viaexam_scan_reopen_requests q
  JOIN ex ON ex."examId" = q."examId"
  WHERE q."instituteId" = :inst AND q.status = 'PENDING'
  GROUP BY 1
),
k AS (SELECT "sessionId" FROM stg UNION SELECT "sessionId" FROM qp UNION SELECT "sessionId" FROM rr UNION SELECT "sessionId" FROM fl UNION SELECT "sessionId" FROM ro)
SELECT k."sessionId", se."sessionName",
       COALESCE(stg.ready, 0) AS ready, COALESCE(stg.cross_check, 0) AS cross_check,
       COALESCE(stg.no_evaluator_sheets, 0) AS no_evaluator_sheets, COALESCE(stg.no_evaluator_due, 0) AS no_evaluator_due,
       COALESCE(stg.no_scanner, 0) AS no_scanner, COALESCE(stg.with_setter, 0) AS with_setter,
       COALESCE(stg.overdue, 0) AS overdue,
       COALESCE(stg.no_setter, 0) AS no_setter, COALESCE(stg.no_date, 0) AS no_date,
       COALESCE(qp.n, 0) AS approvals, COALESCE(rr.n, 0) AS rechecks, COALESCE(fl.n, 0) AS failed,
       COALESCE(ro.n, 0) AS reopen
FROM k
LEFT JOIN viaexam_sessions se ON se."sessionId" = k."sessionId"
LEFT JOIN stg ON stg."sessionId" IS NOT DISTINCT FROM k."sessionId"
LEFT JOIN qp ON qp."sessionId" IS NOT DISTINCT FROM k."sessionId"
LEFT JOIN rr ON rr."sessionId" IS NOT DISTINCT FROM k."sessionId"
LEFT JOIN fl ON fl."sessionId" IS NOT DISTINCT FROM k."sessionId"
LEFT JOIN ro ON ro."sessionId" IS NOT DISTINCT FROM k."sessionId"`;

// Question papers sent for approval, oldest first, from every session.
const ADMIN_APPROVALS_SQL = `
SELECT q."paperId", q.paper_set AS "paperSet", q."submittedAt", u."userName" AS "teacherName", ${EXAM_COLUMNS}, ${EXAM_SESSION_COLUMNS}
FROM viaexam_question_papers q
JOIN viaexam_exams e ON e."examId" = q."examId" AND e."isDeleted" = false
${EXAM_NAMES}
${EXAM_SESSION}
LEFT JOIN viaexam_users u ON u."userId" = q."teacherId"
WHERE q."instituteId" = :inst AND q.status = 'PENDING_APPROVAL' AND q."deletedAt" IS NULL
ORDER BY q."submittedAt" NULLS LAST, q."createdAt"
LIMIT 5`;

// Question papers still with their setters in the sessions that haven't ended, nearest exam first (late ones on top).
const ADMIN_PAPER_SETTING_SQL = `
WITH ${EXAM_DAY}
SELECT ${EXAM_COLUMNS}, ${EXAM_SESSION_COLUMNS}, ${DAY_OF_EXAM} AS "examDay", e."teacherId", u."userName" AS "teacherName"
FROM viaexam_exams e
LEFT JOIN exam_day ON exam_day."examId" = e."examId"
${EXAM_NAMES}
${EXAM_SESSION}
LEFT JOIN viaexam_users u ON u."userId" = e."teacherId"
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e.status IN (:withSetter) AND ${IN_OPEN}
ORDER BY "examDay" NULLS LAST, e."examTime" NULLS LAST, e."createdAt"
LIMIT 6`;

// Students' recheck requests, oldest first, from every session.
const ADMIN_RECHECKS_SQL = `
SELECT rr."requestId", rr."createdAt", u."userName" AS "studentName", ${EXAM_COLUMNS}, ${EXAM_SESSION_COLUMNS}
FROM viaexam_recheck_requests rr
JOIN viaexam_exams e ON e."examId" = rr."examId" AND e."isDeleted" = false
${EXAM_NAMES}
${EXAM_SESSION}
LEFT JOIN viaexam_users u ON u."userId" = rr."studentId"
WHERE rr."instituteId" = :inst AND rr.status = 'Pending'
ORDER BY rr."createdAt"
LIMIT 5`;

// Work per person: open work (teachers: question papers to set in the sessions that haven't
// ended; exams to evaluate, cross-checks and rechecks of every session; scanner staff: exams
// to scan of every session) and, for scanner staff, the answer sheets they uploaded in the
// session shown. The busiest eight of each role (the Staff workload tabs).
const ADMIN_WORKLOAD_SQL = `
WITH w AS (
  SELECT e."teacherId" AS "userId", 'papers' AS kind, COUNT(*)::int AS n
  FROM viaexam_exams e
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."teacherId" IS NOT NULL
    AND e.status IN (:withSetter) AND ${IN_OPEN}
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
  JOIN viaexam_exams e ON e."examId" = ra."examId" AND e."isDeleted" = false
  WHERE ra."instituteId" = :inst AND ra."completedAt" IS NULL
  GROUP BY 1
  UNION ALL
  SELECT a."scannerId", 'scans', COUNT(*)::int
  FROM viaexam_exam_scanner_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false
  WHERE a."instituteId" = :inst AND a."isActive" = true AND a.status = 'ASSIGNED'
  GROUP BY 1
  UNION ALL
  SELECT s."uploadedBy", 'uploaded', COUNT(*)::int
  FROM viaexam_answer_sheets s
  JOIN viaexam_exams e ON e."examId" = s."examId" AND e."isDeleted" = false
  WHERE s."instituteId" = :inst AND s."isDeleted" = false AND s."uploadedBy" IS NOT NULL AND ${IN_SCOPE}
  GROUP BY 1
),
per AS (
  SELECT u."userId", u."userName" AS name, ro.role,
         COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'papers'), 0)::int AS papers,
         COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'evaluations'), 0)::int AS evaluations,
         COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'crossChecks'), 0)::int AS "crossChecks",
         COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'rechecks'), 0)::int AS rechecks,
         COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'scans'), 0)::int AS scans,
         COALESCE(SUM(w.n) FILTER (WHERE w.kind = 'uploaded'), 0)::int AS uploaded,
         COALESCE(SUM(w.n) FILTER (WHERE w.kind <> 'uploaded'), 0)::int AS total
  FROM w
  JOIN viaexam_users u ON u."userId" = w."userId" AND u."isDeleted" = false
  JOIN roles ro ON ro.id = u."roleId"
  GROUP BY u."userId", u."userName", ro.role
)
SELECT * FROM (
  SELECT per.*, ROW_NUMBER() OVER (PARTITION BY role ORDER BY total DESC, uploaded DESC, name) AS rn
  FROM per
) x
WHERE rn <= 8
ORDER BY role, rn`;

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
  WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."createdAt" >= since.t AND ${IN_SCOPE}
  GROUP BY 1
),
sh AS (
  SELECT date_trunc('month', s."createdAt" AT TIME ZONE :tz) AS m, COUNT(*)::int AS n
  FROM viaexam_answer_sheets s, since
  WHERE s."instituteId" = :inst AND s."isDeleted" = false AND s."createdAt" >= since.t
    AND (:ses = '' OR s."examId" IN (SELECT e."examId" FROM viaexam_exams e WHERE e."instituteId" = :inst AND ${IN_SCOPE}))
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

const ADMIN_SESSIONS_SQL = `
SELECT "sessionId", "sessionName", "isActive"
FROM viaexam_sessions
WHERE "instituteId" = :inst AND "isDeleted" = false
ORDER BY "isActive" DESC, "startDate" DESC NULLS LAST`;

const workRow = (x: any) => ({
  userId: x.userId,
  name: x.name ?? "",
  role: x.role === "SCANNER" ? "scanner" : x.role === "TEACHER" ? "teacher" : "staff",
  papers: num(x.papers),
  evaluations: num(x.evaluations),
  crossChecks: num(x.crossChecks),
  rechecks: num(x.rechecks),
  scans: num(x.scans),
  uploaded: num(x.uploaded),
  total: num(x.total),
});

/** An exam row of a list, with its session (lists show the session of rows from another one). */
const listRow = (x: any) => ({ ...examRow(x), sessionId: x.sessionId ?? null, sessionName: x.sessionName ?? null });

interface OpenWorkRow {
  sessionId: string | null;
  sessionName: string | null;
  ready: number;
  crossCheck: number;
  noEvaluatorSheets: number;
  noEvaluatorDue: number;
  noScanner: number;
  withSetter: number;
  overdue: number;
  noSetter: number;
  noDate: number;
  approvals: number;
  rechecks: number;
  failed: number;
  reopen: number;
}

type AttentionKey =
  | "paperSetsToApprove"
  | "papersOverdue"
  | "examsWithoutSetter"
  | "examsWithoutDate"
  | "examsWithoutScanner"
  | "examsWithoutEvaluator"
  | "crossCheckWaiting"
  | "readyToPublish"
  | "rechecksPending"
  | "failedEvaluations"
  | "reopenRequests";

const loadAdminHome = async (instituteId: string, session: { sessionId: string; sessionName: string; isActive: boolean } | null, openIds: string[]) => {
  const rule = (await settingsOf(instituteId)).crossCheck;
  const crossCheck = rule.mode !== "off";
  // IN () is invalid SQL, so "every subject" is its own flag and the list is never empty.
  const ccAllSubjects = rule.subjectIds == null;
  const ccSubjects = rule.subjectIds?.length ? rule.subjectIds : [""];
  const r = {
    inst: instituteId,
    ses: session?.sessionId ?? "",
    open: openIds.length ? openIds : [""],
    approved: PAPER_APPROVED_STATUSES,
    withSetter: PAPER_WITH_SETTER,
    crossCheck,
    ccAllSubjects,
    ccSubjects,
  };
  const [[s], openWork, approvals, paperSetting, rechecks, workload, trends] = await Promise.all([
    select(ADMIN_SUMMARY_SQL, r),
    select(ADMIN_OPEN_WORK_SQL, r),
    select(ADMIN_APPROVALS_SQL, r),
    select(ADMIN_PAPER_SETTING_SQL, r),
    select(ADMIN_RECHECKS_SQL, r),
    select(ADMIN_WORKLOAD_SQL, r),
    select(ADMIN_TRENDS_SQL, r),
  ]);
  const total = num(s?.total);
  const writing = num(s?.qp_writing);
  const sentBack = num(s?.qp_sent_back);
  const waiting = num(s?.qp_waiting);
  const approvedPapers = num(s?.qp_approved);

  const rows: OpenWorkRow[] = openWork.map((x: any) => ({
    sessionId: x.sessionId ?? null,
    sessionName: x.sessionName ?? null,
    ready: num(x.ready),
    crossCheck: num(x.cross_check),
    noEvaluatorSheets: num(x.no_evaluator_sheets),
    noEvaluatorDue: num(x.no_evaluator_due),
    noScanner: num(x.no_scanner),
    withSetter: num(x.with_setter),
    overdue: num(x.overdue),
    noSetter: num(x.no_setter),
    noDate: num(x.no_date),
    approvals: num(x.approvals),
    rechecks: num(x.rechecks),
    failed: num(x.failed),
    reopen: num(x.reopen),
  }));
  // Every kind of admin exam work, for one session.
  const counts: Record<AttentionKey, (x: OpenWorkRow) => number> = {
    paperSetsToApprove: (x) => x.approvals,
    papersOverdue: (x) => x.overdue,
    examsWithoutSetter: (x) => x.noSetter,
    examsWithoutDate: (x) => x.noDate,
    examsWithoutScanner: (x) => x.noScanner,
    failedEvaluations: (x) => x.failed,
    examsWithoutEvaluator: (x) => x.noEvaluatorSheets + x.noEvaluatorDue,
    crossCheckWaiting: (x) => x.crossCheck,
    readyToPublish: (x) => x.ready,
    rechecksPending: (x) => x.rechecks,
    reopenRequests: (x) => x.reopen,
  };
  // What someone is still waiting on, whichever session it belongs to.
  const waitingOn: Partial<Record<AttentionKey, (x: OpenWorkRow) => number>> = {
    paperSetsToApprove: (x) => x.approvals,
    failedEvaluations: (x) => x.failed,
    examsWithoutEvaluator: (x) => x.noEvaluatorSheets,
    crossCheckWaiting: (x) => x.crossCheck,
    readyToPublish: (x) => x.ready,
    rechecksPending: (x) => x.rechecks,
    reopenRequests: (x) => x.reopen,
  };
  const keys = Object.keys(counts) as AttentionKey[];
  // The session shown; with none current, every session (all of them count as not ended then).
  const shown = rows.filter((x) => !session || x.sessionId === session.sessionId);
  const attention = Object.fromEntries(keys.map((k) => [k, shown.reduce((n, x) => n + counts[k](x), 0)])) as Record<AttentionKey, number>;
  // Still waiting in other sessions (sessionId null: answer sheets not linked to an exam), by session.
  const elsewhere = Object.fromEntries(
    keys.map((k) => {
      const of = waitingOn[k];
      return [
        k,
        session && of
          ? rows.filter((x) => x.sessionId !== session.sessionId && of(x) > 0).map((x) => ({ sessionId: x.sessionId, sessionName: x.sessionName ?? "", count: of(x) }))
          : [],
      ];
    })
  ) as Record<AttentionKey, { sessionId: string | null; sessionName: string; count: number }[]>;
  const open = new Set(openIds);

  return {
    generatedAt: new Date().toISOString(),
    /** The session the numbers follow; null = every session. */
    session: session ? { sessionId: session.sessionId, sessionName: session.sessionName, isCurrent: session.isActive } : null,
    sessionName: session?.sessionName ?? null,
    people: {
      students: num(s?.students),
      studentsThisMonth: num(s?.students_month),
      teachers: num(s?.teachers),
      scanners: num(s?.scanners),
      classes: num(s?.classes),
      sections: num(s?.sections),
      subjects: num(s?.subjects),
    },
    exams: { total, today: num(s?.today), next7Days: num(s?.next7) },
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
    attention,
    attentionElsewhere: elsewhere,
    analytics: {
      // Every exam once: the rest of the exams have no question paper started.
      questionPapers: {
        notStarted: Math.max(0, total - writing - sentBack - waiting - approvedPapers),
        writing,
        sentBack,
        waiting,
        approved: approvedPapers,
      },
      // The exams whose question paper is approved, by how far their scanning is.
      scanning: {
        noScanner: num(s?.scan_none),
        assigned: num(s?.scan_assigned),
        uploading: num(s?.scan_uploading),
        completed: num(s?.scan_completed),
      },
    },
    approvals: approvals.map((x: any) => ({
      ...listRow(x),
      paperId: x.paperId,
      paperSet: x.paperSet ?? null,
      teacherName: x.teacherName ?? "",
      submittedAt: x.submittedAt ?? null,
    })),
    paperSetting: {
      open: rows.filter((x) => x.sessionId !== null && open.has(x.sessionId)).reduce((n, x) => n + x.withSetter, 0),
      items: paperSetting.map((x: any) => ({ ...listRow(x), examDate: x.examDay ?? null, teacherId: x.teacherId ?? null, teacherName: x.teacherName ?? "" })),
    },
    rechecks: rechecks.map((x: any) => ({ ...listRow(x), requestId: x.requestId, studentName: x.studentName ?? "", requestedAt: x.createdAt })),
    workload: {
      teachers: workload.filter((x: any) => x.role === "TEACHER").map(workRow),
      scanners: workload.filter((x: any) => x.role === "SCANNER").map(workRow),
    },
    trends: trends.map((x: any) => ({
      month: x.month,
      students: num(x.students),
      teachers: num(x.teachers),
      scanners: num(x.scanners),
      exams: num(x.exams),
      sheets: num(x.sheets),
    })),
  };
};

/** `sessionId`: a session of the school, "all", or blank for the current one (an unknown id also means the current one). */
const getAdminHome = async (user: any, query: { sessionId?: string | null } = {}) => {
  try {
    const instituteId = String(user?.instituteId ?? "");
    if (!instituteId) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Institute not found for this user." };
    const [sessions, openIds] = await Promise.all([
      select<{ sessionId: string; sessionName: string; isActive: boolean }>(ADMIN_SESSIONS_SQL, { inst: instituteId }),
      openSessionIds(instituteId),
    ]);
    const wanted = String(query.sessionId ?? "").trim();
    const session =
      wanted === ALL_SESSIONS ? null : (sessions.find((x) => x.sessionId === wanted) ?? sessions.find((x) => x.isActive) ?? null);
    return ok(
      "Admin home loaded.",
      await memoize(`home:admin:${instituteId}:${session?.sessionId ?? ALL_SESSIONS}`, ADMIN_CACHE_MS, () => loadAdminHome(instituteId, session, openIds))
    );
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
// TEACHER — papers to set, evaluations, cross-checks, rechecks (current session)
// ═════════════════════════════════════════════════════════════════════════════
//
// Everything counts exams of the current session only (:ses); my subjects and classes are
// what the admin gave me to teach in it.

const TEACHER_SUMMARY_SQL = `
WITH my AS (SELECT status FROM viaexam_exams WHERE "instituteId" = :inst AND "teacherId" = :uid AND "isDeleted" = false AND "sessionId" = :ses),
ev AS (
  SELECT a."reviewedAt" FROM viaexam_evaluation_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false AND e."sessionId" = :ses
  WHERE a."instituteId" = :inst AND a."teacherId" = :uid AND a."isActive" = true
),
rc AS (
  SELECT ra."completedAt", ra."previousScore", ra."revisedScore" FROM viaexam_recheck_assignments ra
  JOIN viaexam_exams e ON e."examId" = ra."examId" AND e."sessionId" = :ses
  WHERE ra."instituteId" = :inst AND ra."teacherId" = :uid
),
teaching AS (
  SELECT ss."classId", ss."subjectId" FROM viaexam_session_subjects ss
  JOIN viaexam_subjects sb ON sb."subjectId" = ss."subjectId" AND sb."isDeleted" = false
  WHERE ss."instituteId" = :inst AND ss."sessionId" = :ses AND ss."teacherId" = :uid
),
-- Each exam I evaluate, by the step it has reached (as the admin's exam stages).
mev AS (
  SELECT CASE
           WHEN EXISTS (SELECT 1 FROM viaexam_student_results r WHERE r."examId" = a."examId" AND r."isDeleted" = false) THEN 'PUBLISHED'
           WHEN a."reviewedAt" IS NOT NULL THEN 'CONFIRMED'
           WHEN (SELECT sc.status FROM viaexam_exam_scanner_assignments sc
                 WHERE sc."examId" = a."examId" AND sc."isActive" = true LIMIT 1) = 'COMPLETED' THEN 'ALL_IN'
           WHEN EXISTS (SELECT 1 FROM viaexam_answer_sheets s WHERE s."examId" = a."examId" AND s."isDeleted" = false) THEN 'UPLOADING'
           ELSE 'NO_SHEETS'
         END AS stage
  FROM viaexam_evaluation_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false AND e."sessionId" = :ses
  WHERE a."instituteId" = :inst AND a."teacherId" = :uid AND a."isActive" = true
)
SELECT
  (SELECT COUNT(*) FROM my)::int AS papers_total,
  (SELECT COUNT(*) FROM my WHERE status = 'Draft')::int AS draft,
  (SELECT COUNT(*) FROM my WHERE status = 'Paper Created')::int AS writing,
  (SELECT COUNT(*) FROM mev WHERE stage = 'NO_SHEETS')::int AS ev_no_sheets,
  (SELECT COUNT(*) FROM mev WHERE stage = 'UPLOADING')::int AS ev_uploading,
  (SELECT COUNT(*) FROM mev WHERE stage = 'ALL_IN')::int AS ev_all_in,
  (SELECT COUNT(*) FROM mev WHERE stage = 'CONFIRMED')::int AS ev_confirmed,
  (SELECT COUNT(*) FROM mev WHERE stage = 'PUBLISHED')::int AS ev_published,
  (SELECT COUNT(*) FROM rc WHERE "completedAt" IS NOT NULL
     AND ("previousScore" IS NULL OR "revisedScore" IS NULL OR abs("revisedScore" - "previousScore") < 0.005))::int AS recheck_kept,
  (SELECT COUNT(*) FROM my WHERE status IN ('Draft', 'Paper Created'))::int AS to_prepare,
  (SELECT COUNT(*) FROM my WHERE status = 'Rejected')::int AS rejected,
  (SELECT COUNT(*) FROM my WHERE status = 'Pending Approval')::int AS pending_approval,
  (SELECT COUNT(*) FROM my WHERE status IN (:approved))::int AS approved,
  (SELECT COUNT(*) FROM ev WHERE "reviewedAt" IS NULL)::int AS eval_open,
  (SELECT COUNT(*) FROM ev WHERE "reviewedAt" IS NOT NULL)::int AS eval_reviewed,
  (SELECT COUNT(*) FROM rc WHERE "completedAt" IS NULL)::int AS recheck_open,
  (SELECT COUNT(*) FROM rc WHERE "completedAt" IS NOT NULL)::int AS recheck_done,
  (SELECT COUNT(*) FROM viaexam_cross_check_rounds r
    JOIN viaexam_exams e ON e."examId" = r."examId" AND e."sessionId" = :ses
    WHERE r."instituteId" = :inst AND r."checkerId" = :uid AND r."isActive" = true AND r.status = 'open')::int AS cross_check_open,
  (SELECT COUNT(*) FROM teaching)::int AS subjects,
  (SELECT COUNT(DISTINCT "classId") FROM teaching)::int AS classes`;

// Everything waiting on this teacher, most blocking first, then by exam date.
const TEACHER_TASKS_SQL = `
SELECT t.* FROM (
  SELECT CASE WHEN e.status = 'Rejected' THEN 'FIX_PAPER' ELSE 'SET_PAPER' END AS kind,
         NULL::varchar AS "requestId", NULL::timestamptz AS "assignedAt", ${EXAM_COLUMNS}
  FROM viaexam_exams e
  ${EXAM_NAMES}
  WHERE e."instituteId" = :inst AND e."teacherId" = :uid AND e."isDeleted" = false AND e."sessionId" = :ses
    AND e.status IN ('Draft', 'Paper Created', 'Rejected')
  UNION ALL
  SELECT 'EVALUATE', NULL, a."createdAt", ${EXAM_COLUMNS}
  FROM viaexam_evaluation_assignments a
  JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false AND e."sessionId" = :ses
  ${EXAM_NAMES}
  WHERE a."instituteId" = :inst AND a."teacherId" = :uid AND a."isActive" = true AND a."reviewedAt" IS NULL
  UNION ALL
  SELECT 'RECHECK', ra."requestId", ra."assignedAt", ${EXAM_COLUMNS}
  FROM viaexam_recheck_assignments ra
  JOIN viaexam_exams e ON e."examId" = ra."examId" AND e."sessionId" = :ses
  ${EXAM_NAMES}
  WHERE ra."instituteId" = :inst AND ra."teacherId" = :uid AND ra."completedAt" IS NULL
  UNION ALL
  SELECT 'CROSS_CHECK', NULL, r."createdAt", ${EXAM_COLUMNS}
  FROM viaexam_cross_check_rounds r
  JOIN viaexam_exams e ON e."examId" = r."examId" AND e."isDeleted" = false AND e."sessionId" = :ses
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
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."sessionId" = :ses AND e."examDate" >= ${TODAY}
  AND (e."teacherId" = :uid
       OR e."subjectId" IN (SELECT "subjectId" FROM viaexam_session_subjects WHERE "instituteId" = :inst AND "sessionId" = :ses AND "teacherId" = :uid)
       OR e."examId" IN (SELECT "examId" FROM viaexam_evaluation_assignments WHERE "teacherId" = :uid AND "isActive" = true))
ORDER BY e."examDate", e."examTime" NULLS LAST
LIMIT 6`;

// Every exam of the current session I set the paper for or evaluate: the calendar marks them
// and says what I do in each (ids and names only, newest first).
const TEACHER_MY_EXAMS_SQL = `
SELECT e."examId", e."examType", e.status, ${EXAM_SESSION_COLUMNS}, e."classId", c."className",
       sec."sectionName", e."subjectId", sub."subjectName",
       (e."teacherId" = :uid) AS "isPaperSetter",
       ev."examId" IS NOT NULL AS "isEvaluator",
       ev."reviewedAt" IS NOT NULL AS "isReviewed"
FROM viaexam_exams e
${EXAM_NAMES}
${EXAM_SESSION}
LEFT JOIN LATERAL (
  SELECT a."examId", a."reviewedAt" FROM viaexam_evaluation_assignments a
  WHERE a."examId" = e."examId" AND a."teacherId" = :uid AND a."isActive" = true
  LIMIT 1
) ev ON true
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."sessionId" = :ses
  AND (e."teacherId" = :uid OR ev."examId" IS NOT NULL)
ORDER BY e."createdAt" DESC
LIMIT 500`;

const OPEN_EVALUATIONS_SQL = `
SELECT a."examId", a."createdAt" AS "assignedAt"
FROM viaexam_evaluation_assignments a
JOIN viaexam_exams e ON e."examId" = a."examId" AND e."isDeleted" = false AND e."sessionId" = :ses
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
        sessionName: exam.session?.sessionName ?? "",
        className: exam.class?.className ?? "",
        sectionName: exam.section?.sectionName ?? "",
        subjectName: exam.subject?.subjectName ?? "",
        counts,
      };
    })
  );
};

const loadTeacherHome = async (instituteId: string, userId: string, session: HomeSession | null) => {
  // No current session: nothing matches "" (every exam has a session), so the page is empty.
  const r = { inst: instituteId, uid: userId, ses: session?.sessionId ?? "", approved: PAPER_APPROVED_STATUSES };
  const [[s], tasks, upcoming, open, mine] = await Promise.all([
    select(TEACHER_SUMMARY_SQL, r),
    select(TEACHER_TASKS_SQL, r),
    select(TEACHER_UPCOMING_SQL, r),
    select<{ examId: string; assignedAt: string }>(OPEN_EVALUATIONS_SQL, r),
    select(TEACHER_MY_EXAMS_SQL, r),
  ]);
  const progress = await progressOf(instituteId, open.map((o) => o.examId));
  const assignedAt = new Map(open.map((o) => [o.examId, o.assignedAt]));

  return {
    generatedAt: new Date().toISOString(),
    session,
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
    // The dashboard donuts: each is one set of my work, by the step it has reached.
    analytics: {
      papers: {
        notStarted: num(s?.draft),
        writing: num(s?.writing),
        sentBack: num(s?.rejected),
        waiting: num(s?.pending_approval),
        approved: num(s?.approved),
      },
      evaluations: {
        noSheets: num(s?.ev_no_sheets),
        uploading: num(s?.ev_uploading),
        allIn: num(s?.ev_all_in),
        confirmed: num(s?.ev_confirmed),
        published: num(s?.ev_published),
      },
      rechecks: {
        open: num(s?.recheck_open),
        kept: num(s?.recheck_kept),
        changed: Math.max(0, num(s?.recheck_done) - num(s?.recheck_kept)),
      },
    },
    tasks: tasks.map((x: any) => ({ ...examRow(x), kind: x.kind, requestId: x.requestId ?? null, assignedAt: x.assignedAt ?? null })),
    evaluationProgress: progress.map((p) => ({ ...p, assignedAt: assignedAt.get(p.examId) ?? null })),
    upcoming: upcoming.map((x: any) => ({ ...examRow(x), isPaperSetter: Boolean(x.isPaperSetter), isEvaluator: Boolean(x.isEvaluator) })),
    myExams: mine.map((x: any) => ({
      examId: x.examId,
      examType: x.examType ?? "",
      status: x.status ?? "",
      sessionId: x.sessionId ?? null,
      sessionName: x.sessionName ?? "",
      classId: x.classId ?? null,
      className: x.className ?? "",
      sectionName: x.sectionName ?? "",
      subjectId: x.subjectId ?? null,
      subjectName: x.subjectName ?? "",
      isPaperSetter: Boolean(x.isPaperSetter),
      isEvaluator: Boolean(x.isEvaluator),
      isReviewed: Boolean(x.isReviewed),
    })),
  };
};

const getTeacherHome = async (user: any) => {
  try {
    const instituteId = String(user?.instituteId ?? "");
    const userId = String(user?.userId ?? "");
    const session = await currentSessionOf(instituteId);
    return ok(
      "Teacher home loaded.",
      await memoize(`home:teacher:${instituteId}:${userId}:${session?.sessionId ?? "none"}`, USER_CACHE_MS, () => loadTeacherHome(instituteId, userId, session))
    );
  } catch (e) {
    return fail("teacher", e);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// SCANNER — assigned exams and own uploads (current session)
// ═════════════════════════════════════════════════════════════════════════════
//
// Assignments, absentees and sheets count through their exam, so only the current
// session's (:ses) count. Sheets saved without an exam can't be placed in a session.

/** The current session's exams (the CTE every scanner query filters through). */
const SESSION_EXAMS = `ses_exams AS (SELECT "examId" FROM viaexam_exams WHERE "instituteId" = :inst AND "sessionId" = :ses AND "isDeleted" = false)`;

const SCANNER_SUMMARY_SQL = `
WITH ${SESSION_EXAMS}
SELECT
  (SELECT COUNT(*) FROM viaexam_exam_scanner_assignments
    WHERE "instituteId" = :inst AND "scannerId" = :uid AND "isActive" = true AND status = 'ASSIGNED'
      AND "examId" IN (SELECT "examId" FROM ses_exams))::int AS open,
  (SELECT COUNT(*) FROM viaexam_exam_scanner_assignments
    WHERE "instituteId" = :inst AND "scannerId" = :uid AND "isActive" = true AND status = 'COMPLETED'
      AND "examId" IN (SELECT "examId" FROM ses_exams))::int AS completed,
  (SELECT COUNT(*) FROM viaexam_exam_attendance
    WHERE "instituteId" = :inst AND "markedBy" = :uid AND status = 'ABSENT'
      AND "examId" IN (SELECT "examId" FROM ses_exams))::int AS absent_marked,
  u.*
FROM (
  SELECT COUNT(*)::int AS uploads_total,
         COUNT(*) FILTER (WHERE "createdAt" >= (date_trunc('day', now() AT TIME ZONE :tz) AT TIME ZONE :tz))::int AS uploads_today,
         COUNT(*) FILTER (WHERE "createdAt" >= now() - interval '7 days')::int AS uploads_7d
  FROM viaexam_answer_sheets
  WHERE "instituteId" = :inst AND "uploadedBy" = :uid AND "isDeleted" = false AND "examId" IN (SELECT "examId" FROM ses_exams)
) u`;

const SCANNER_DAILY_SQL = `
WITH days AS (${DAY_SERIES}),
${SESSION_EXAMS},
up AS (
  SELECT (s."createdAt" AT TIME ZONE :tz)::date AS day, COUNT(*)::int AS n
  FROM viaexam_answer_sheets s
  WHERE s."instituteId" = :inst AND s."uploadedBy" = :uid AND s."isDeleted" = false AND s."createdAt" >= ${SERIES_START}
    AND s."examId" IN (SELECT "examId" FROM ses_exams)
  GROUP BY 1
)
SELECT to_char(days.day, 'YYYY-MM-DD') AS day, COALESCE(up.n, 0) AS uploaded, 0 AS evaluated
FROM days LEFT JOIN up ON up.day = days.day
ORDER BY days.day`;

// Scanner staff never see evaluation, so a sheet here is only "uploaded", never "evaluated".
const SCANNER_RECENT_SQL = `
WITH ${SESSION_EXAMS}
SELECT s."sheetId", s."rollNo", s."studentName", s."createdAt", s."examType",
       COALESCE(c."className", s."classId") AS "className", s.section AS "sectionName", sub."subjectName"
FROM viaexam_answer_sheets s
LEFT JOIN viaexam_classes c ON c."classId" = s."classId"
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = s."subjectId"
WHERE s."instituteId" = :inst AND s."uploadedBy" = :uid AND s."isDeleted" = false AND s."examId" IN (SELECT "examId" FROM ses_exams)
ORDER BY s."createdAt" DESC
LIMIT 6`;

/** Every exam of the session given to this scanner (open and completed), with roster counts, as My Exams lists them. */
const scanExamsOf = async (user: any, sessionId: string) => {
  const page = (n: number) => ExamWorkflowService.myScanExams(user, { sessionId, limit: 100, page: n });
  const first = await page(1);
  let exams = first.exams;
  for (let n = 2; n <= first.pagination.totalPages; n += 1) exams = exams.concat((await page(n)).exams);
  return exams;
};

const loadScannerHome = async (user: any, session: HomeSession | null) => {
  // No current session: nothing matches "" (every exam has a session), so the page is empty.
  const r = { inst: String(user.instituteId), uid: String(user.userId), ses: session?.sessionId ?? "", days: DAYS };
  const [[s], daily, recent, exams] = await Promise.all([
    select(SCANNER_SUMMARY_SQL, r),
    select(SCANNER_DAILY_SQL, r),
    select(SCANNER_RECENT_SQL, r),
    session ? scanExamsOf(user, session.sessionId) : Promise.resolve([]),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    session,
    assignments: { open: num(s?.open), completed: num(s?.completed) },
    uploads: { total: num(s?.uploads_total), today: num(s?.uploads_today), last7Days: num(s?.uploads_7d) },
    absentMarked: num(s?.absent_marked),
    daily: series(daily),
    exams,
    recentUploads: recent.map((x: any) => ({
      sheetId: x.sheetId,
      rollNo: x.rollNo ?? "",
      studentName: maskName(x.studentName) ?? "",
      examType: x.examType ?? "",
      className: x.className ?? "",
      sectionName: x.sectionName ?? "",
      subjectName: x.subjectName ?? "",
      uploadedAt: x.createdAt,
    })),
  };
};

const getScannerHome = async (user: any) => {
  try {
    const session = await currentSessionOf(String(user?.instituteId ?? ""));
    const key = `home:scanner:${user?.instituteId}:${user?.userId}:${session?.sessionId ?? "none"}`;
    return ok("Scanner home loaded.", await memoize(key, USER_CACHE_MS, () => loadScannerHome(user, session)));
  } catch (e) {
    return fail("scanner", e);
  }
};

// ═════════════════════════════════════════════════════════════════════════════
// STUDENT — timetable, published results, rechecks (current session)
// ═════════════════════════════════════════════════════════════════════════════
//
// The class, timetable, results and rechecks of the current session (:ses) only.

// The student's enrolment in the current session (none when not enrolled in it).
const STUDENT_PROFILE_SQL = `
SELECT e."rollNumber", se."sessionName", e."sessionId", e."classId",
       COALESCE(c."className", '') AS "className", sec."sectionName", e."sectionId"
FROM viaexam_student_enrollments e
JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
WHERE e."studentId" = :uid AND e."instituteId" = :inst AND e."sessionId" = :ses
ORDER BY e."isActive" DESC
LIMIT 1`;

const STUDENT_UPCOMING_SQL = `
SELECT ${EXAM_COLUMNS}, e.duration, e."totalMarks"
FROM viaexam_exams e
${EXAM_NAMES}
WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."examDate" >= ${TODAY}
  AND e."classId" = :classId AND e."sessionId" = :ses
  AND (e."sectionId" IS NULL OR e."sectionId" = '' OR e."sectionId" IN (:sectionKeys) OR sec."sectionName" IN (:sectionKeys))
ORDER BY e."examDate", e."examTime" NULLS LAST
LIMIT 6`;

/** Recheck requests on the current session's exams. */
const STUDENT_SESSION_RECHECKS = `rr."examId" IN (SELECT "examId" FROM viaexam_exams WHERE "instituteId" = :inst AND "sessionId" = :ses)`;

const STUDENT_RESULTS_SQL = `
SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE "resultStatus" = 'PASS')::int AS passed,
       COUNT(*) FILTER (WHERE "resultStatus" = 'FAIL')::int AS failed,
       COUNT(*) FILTER (WHERE "resultStatus" = 'ABSENT')::int AS absent,
       AVG(percentage) FILTER (WHERE "resultStatus" IN ('PASS', 'FAIL')) AS average,
       MAX(percentage) FILTER (WHERE "resultStatus" IN ('PASS', 'FAIL')) AS best,
       (SELECT COUNT(*) FROM viaexam_recheck_requests rr
         WHERE rr."studentId" = :uid AND rr."instituteId" = :inst AND rr.status IN ('Pending', 'Under Review', 'Approved')
           AND ${STUDENT_SESSION_RECHECKS})::int AS rechecks_open,
       (SELECT COUNT(*) FROM viaexam_recheck_requests rr
         WHERE rr."studentId" = :uid AND rr."instituteId" = :inst AND rr.status IN ('Completed', 'Rejected')
           AND ${STUDENT_SESSION_RECHECKS})::int AS rechecks_closed
FROM viaexam_student_results
WHERE "studentId" = :uid AND "instituteId" = :inst AND "isDeleted" = false AND "sessionId" = :ses`;

const STUDENT_LATEST_SQL = `
SELECT r."resultId", r."examId", r."examType", r."marksObtained", r."totalMarks", r.percentage, r.grade,
       r."resultStatus", r."publishedAt", sub."subjectName", rr.status AS "recheckStatus"
FROM viaexam_student_results r
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = r."subjectId"
LEFT JOIN viaexam_recheck_requests rr ON rr."examId" = r."examId" AND rr."studentId" = r."studentId"
WHERE r."studentId" = :uid AND r."instituteId" = :inst AND r."isDeleted" = false AND r."sessionId" = :ses
ORDER BY r."publishedAt" DESC
LIMIT 6`;

const STUDENT_SUBJECTS_SQL = `
SELECT COALESCE(sub."subjectName", 'Subject') AS "subjectName", AVG(r.percentage) AS average, COUNT(*)::int AS exams
FROM viaexam_student_results r
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = r."subjectId"
WHERE r."studentId" = :uid AND r."instituteId" = :inst AND r."isDeleted" = false AND r."sessionId" = :ses
  AND r."resultStatus" IN ('PASS', 'FAIL')
GROUP BY 1
ORDER BY 2 DESC
LIMIT 8`;

const STUDENT_RECHECKS_SQL = `
SELECT rr."requestId", rr.status, rr."createdAt", rr."completedAt", sub."subjectName", e."examType"
FROM viaexam_recheck_requests rr
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = rr."subjectId"
LEFT JOIN viaexam_exams e ON e."examId" = rr."examId"
WHERE rr."studentId" = :uid AND rr."instituteId" = :inst AND ${STUDENT_SESSION_RECHECKS}
ORDER BY rr."createdAt" DESC
LIMIT 4`;

const loadStudentHome = async (instituteId: string, userId: string, session: HomeSession | null) => {
  // No current session: nothing matches "" (every exam and result has a session), so the page is empty.
  const r = { inst: instituteId, uid: userId, ses: session?.sessionId ?? "" };
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
    ? await select(STUDENT_UPCOMING_SQL, { ...r, classId: profile.classId, sectionKeys: sectionKeys.length ? sectionKeys : [""] })
    : [];

  return {
    generatedAt: new Date().toISOString(),
    session,
    profile: {
      className: profile?.className ?? "",
      sectionName: profile?.sectionName ?? "",
      rollNumber: profile?.rollNumber ?? "",
      sessionName: session?.sessionName ?? "",
      /** Enrolled in the current session (else no class, timetable or results show). */
      enrolled: Boolean(profile),
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
    const session = await currentSessionOf(instituteId);
    return ok(
      "Student home loaded.",
      await memoize(`home:student:${instituteId}:${userId}:${session?.sessionId ?? "none"}`, USER_CACHE_MS, () => loadStudentHome(instituteId, userId, session))
    );
  } catch (e) {
    return fail("student", e);
  }
};

export default { getAdminHome, getSetupStatus, getTeacherHome, getScannerHome, getStudentHome };
