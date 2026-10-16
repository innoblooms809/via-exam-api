import httpStatus from "http-status";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import logger from "../../config/logger";
import { EXAM_TYPES, EXAM_TYPE_HINT, normalizeExamType } from "../../utils/examTypes";

// One person's page for the institute admin: who they are, a few numbers, their work
// (pending / completed) and a history of everything that happened to or by them, all
// for one academic session (the current one unless the admin picks another, or "all"),
// and optionally one exam (Mid Term or Final).
//
//   GET /v1/home/people/:userId            profile, numbers and the first page of each list
//   GET /v1/home/people/:userId/work       next page of pending or completed work
//   GET /v1/home/people/:userId/history    next page of the activity log
//
// Lists are paged in SQL with keyset cursors (no OFFSET), so a person with tens of
// thousands of exams, uploads or sign-ins costs the same per page as one with five, and
// rows added while the admin scrolls never repeat or go missing. Numbers are COUNTs.
// The history is read from the records themselves (papers, assignments, uploads, marks,
// results, rechecks), so it is complete even for work done before the activity log
// existed; the log only adds sign-ins.

const PEOPLE_ROLES = ["TEACHER", "SCANNER", "STUDENT"] as const;
type Role = (typeof PEOPLE_ROLES)[number];

export const PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

/** "all" = every session; an unknown or missing id = the current (active) session. */
export const ALL_SESSIONS = "all";

const num = (v: unknown) => Number(v) || 0;
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);
const select = <T extends object = any>(sql: string, replacements: Record<string, unknown>): Promise<T[]> =>
  sequelize.query<T>(sql, { type: QueryTypes.SELECT, replacements });

class BadRequest extends Error {}

// ─── SQL pieces ───────────────────────────────────────────────────────────────

const EXAM_NAMES = `
  LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
  LEFT JOIN viaexam_sections sec ON sec."sectionId" = e."sectionId"
  LEFT JOIN viaexam_subjects sub ON sub."subjectId" = e."subjectId"`;
const EXAM_COLUMNS = `e."examId", e."examType", e."examDate", c."className", sec."sectionName", sub."subjectName"`;
const NO_EXAM = `NULL::text AS "examId", NULL::text AS "examType", NULL::date AS "examDate"`;
// Work tied to an exam belongs to the exam's session and type (Mid Term / Final);
// '' means every session / every exam.
const IN_SCOPE = `AND (:session = '' OR e."sessionId" = :session) AND (:examType = '' OR e."examType" = :examType)`;
/** Events not tied to an exam (joining, sign-ins) count in the session whose dates they fall in. */
const inRange = (col: string, ranged: boolean) => (ranged ? `AND ${col} >= CAST(:from AS timestamptz) AND ${col} < CAST(:to AS timestamptz)` : "");
const X = (n: number) => Array.from({ length: n }, (_, i) => `NULL::text AS x${i + 1}`).join(", ");

const BASE_SQL = `
SELECT u."userId", u."userName", u."emailId", u."phoneNumber", u.status, u."createdAt", u."updatedAt",
       -- Their own photo first, then the one the admin added on their role's profile.
       COALESCE(u."profileUrl", tp."profileUrl", sp."profileUrl", st."profileUrl") AS "profileUrl",
       u."lastLoginAt", UPPER(r.role) AS role,
       ps."presenceStatus", ps."lastActivityAt", ps."lastLoginAt" AS "presenceLoginAt"
FROM viaexam_users u
JOIN roles r ON r.id = u."roleId"
LEFT JOIN viaexam_user_presence_sessions ps ON ps."userId" = u."userId"
LEFT JOIN viaexam_teacher_profiles tp ON tp."userId" = u."userId"
LEFT JOIN viaexam_scanner_profiles sp ON sp."userId" = u."userId"
LEFT JOIN viaexam_student_profiles st ON st."userId" = u."userId"
WHERE (u."userId" = :id OR st."rollNumber" = :id OR EXISTS (
        SELECT 1 FROM viaexam_student_enrollments en
        WHERE en."studentId" = u."userId" AND (en."rollNumber" = :id OR en."enrollmentId" = :id)
      ))
  AND (u."instituteId" = :inst OR st."instituteId" = :inst)
  AND (u."isDeleted" = false OR u."isDeleted" IS NULL)`;

const LAST_SIGN_IN_SQL = `
SELECT MAX("createdAt") AS at FROM viaexam_activity_logs
WHERE "userId" = :id AND "instituteId" = :inst AND "eventType" = 'LOGIN_SUCCESS'`;

const SESSIONS_SQL = `
SELECT "sessionId", "sessionName", "startDate", "endDate", "isActive" FROM viaexam_sessions
WHERE "instituteId" = :inst AND "isDeleted" = false
ORDER BY "startDate" DESC`;

// Personal details from the profile; class, section, roll and class teacher from the
// enrolment of the session asked for (every session: the current one, else the latest).
const STUDENT_PROFILE_SQL = `
SELECT COALESCE(p."fatherName", '') AS "fatherName", p.gender, p.dob, p.address,
       COALESCE(p."isActive", true) AS "isActive", COALESCE(p."createdAt", u."createdAt") AS "createdAt",
       e."classId", e."sectionId", e."rollNumber", e."sessionId", se."sessionName" AS session,
       c."className", s."sectionName", t."userName" AS "classTeacher"
FROM viaexam_users u
LEFT JOIN viaexam_student_profiles p ON p."userId" = u."userId"
LEFT JOIN LATERAL (
  SELECT x.* FROM viaexam_student_enrollments x JOIN viaexam_sessions xs ON xs."sessionId" = x."sessionId"
  WHERE x."studentId" = u."userId" AND (:session = '' OR x."sessionId" = :session)
  ORDER BY xs."isActive" DESC, xs."startDate" DESC LIMIT 1
) e ON true
LEFT JOIN viaexam_sessions se ON se."sessionId" = e."sessionId"
LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
LEFT JOIN viaexam_sections s ON s."sectionId" = e."sectionId"
LEFT JOIN viaexam_session_sections ss ON ss."sessionId" = e."sessionId" AND ss."sectionId" = e."sectionId"
LEFT JOIN viaexam_users t ON t."userId" = ss."classTeacherId"
WHERE u."userId" = :id`;

// Sheets carry the roll number, not the student id: a sheet is the student's when its
// class and roll match what they had in that exam's session.
const STUDENT_SHEETS = `s."instituteId" = :inst AND s."isDeleted" = false AND (
  EXISTS (
    SELECT 1 FROM viaexam_student_enrollments en
    WHERE en."studentId" = :id AND en."sessionId" = e."sessionId" AND en."classId" = s."classId" AND en."rollNumber" = s."rollNo"
      AND (e."sectionId" IS NULL OR e."sectionId" = '' OR e."sectionId" = en."sectionId")
  ) OR EXISTS (
    SELECT 1 FROM viaexam_student_profiles sp
    WHERE sp."userId" = :id AND sp."classId" = s."classId" AND sp."rollNumber" = s."rollNo"
  )
)`;

// Exams of the student: their class (and section) in each session they studied in.
const STUDENT_EXAMS = `e."instituteId" = :inst AND e."isDeleted" = false AND (
  EXISTS (
    SELECT 1 FROM viaexam_student_enrollments en
    WHERE en."studentId" = :id AND en."sessionId" = e."sessionId" AND en."classId" = e."classId"
      AND (e."sectionId" IS NULL OR e."sectionId" = '' OR e."sectionId" = en."sectionId")
  ) OR EXISTS (
    SELECT 1 FROM viaexam_student_profiles sp
    WHERE sp."userId" = :id AND sp."classId" = e."classId"
  )
)`;

// ─── Session ──────────────────────────────────────────────────────────────────

interface SessionRow {
  sessionId: string;
  sessionName: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
}

const pickSession = (sessions: SessionRow[], wanted?: string | null): SessionRow | null => {
  if (wanted === ALL_SESSIONS) return null;
  return sessions.find((s) => s.sessionId === wanted) ?? sessions.find((s) => s.isActive) ?? sessions[0] ?? null;
};

/** The day after the session's end date, so the whole last day counts. */
const dayAfter = (v: string) => {
  const d = new Date(v);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + 864e5).toISOString();
};

interface Ctx {
  base: any;
  role: Role;
  sessions: SessionRow[];
  session: SessionRow | null;
  /** SQL replacements: person, institute, session and its dates (and the student's class). */
  r: Record<string, unknown>;
  ranged: boolean;
  studentProfile: any;
}

/** The person (in this institute) and the session asked for; null when they aren't found. */
const context = async (user: any, userId: string, query: PersonQuery): Promise<Ctx | null> => {
  const inst = String(user?.instituteId ?? "");
  const id = String(userId ?? "");
  if (!inst || !id) return null;
  const examType = query.examType ? normalizeExamType(query.examType) : null;
  if (query.examType && !examType) throw new BadRequest(EXAM_TYPE_HINT);
  const sessionId = query.sessionId;
  const [[base], sessions] = await Promise.all([select(BASE_SQL, { id, inst }), select<SessionRow>(SESSIONS_SQL, { inst })]);
  const role = (base?.role ? String(base.role).toUpperCase() : "") as Role;
  if (!base || !PEOPLE_ROLES.includes(role)) return null;
  base.role = role;

  const canonicalId = base.userId;
  const session = pickSession(sessions, sessionId);
  const [studentProfile] = base.role === "STUDENT" ? await select(STUDENT_PROFILE_SQL, { id: canonicalId, session: session?.sessionId ?? "" }) : [];
  // What a teacher teaches is per session; "every session" shows the current one.
  const teachSession = session?.sessionId ?? sessions.find((s) => s.isActive)?.sessionId ?? "";
  return {
    base,
    role: base.role,
    sessions,
    session,
    ranged: Boolean(session),
    studentProfile: studentProfile ?? null,
    r: {
      id: canonicalId,
      inst,
      session: session?.sessionId ?? "",
      examType: examType ?? "",
      from: session ? iso(session.startDate) : null,
      to: session ? dayAfter(session.endDate) : null,
      teachSession,
    },
  };
};

// ─── Paging ───────────────────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  /** Cursor for the next page; null on the last page. */
  nextCursor: string | null;
  /** Rows in the whole list (first page only; later pages send null). */
  total: number | null;
  /** Rows per group (work) or kind (history); first page only. */
  counts: Record<string, number> | null;
}

const pageSize = (v: unknown) => Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(v)) || PAGE_SIZE));

const encodeCursor = (c: Record<string, unknown>) => Buffer.from(JSON.stringify(c)).toString("base64url");
const decodeCursor = (v: string | null | undefined, fields: string[]): Record<string, any> | null => {
  if (!v) return null;
  try {
    const c = JSON.parse(Buffer.from(v, "base64url").toString("utf8"));
    if (c && typeof c === "object" && fields.every((f) => f in c) && !Number.isNaN(new Date(c.at).getTime())) return c;
  } catch {
    /* fall through */
  }
  throw new BadRequest("This list link has expired. Reload the page.");
};

// ─── Work (pending / completed) ───────────────────────────────────────────────

/** One row in "Pending work" or "Completed work"; the role-specific fields are set where they apply. */
export interface WorkItem {
  key: string;
  group: string;
  examId: string;
  name: string;
  subjectName: string;
  examType: string;
  className: string;
  sectionName: string;
  examDate: string | null;
  // Teacher
  paper?: string;
  assignedAt?: string | null;
  reviewedAt?: string | null;
  // Scanner
  status?: string;
  uploaded?: number;
  completedAt?: string | null;
  // Student
  marks?: number;
  total?: number;
  percentage?: number | null;
  grade?: string | null;
  passed?: boolean;
  resultStatus?: string | null;
  publishedAt?: string | null;
}

type WorkStatus = "pending" | "done";

/**
 * Per role: one SQL list of every work row with its group, the group's rank (order in the
 * panel), a sort time and a unique key. Groups are listed pending-first, newest first.
 */
const WORK: Record<Role, { groups: Record<WorkStatus, string[]>; sql: string }> = {
  TEACHER: {
    groups: { pending: ["papers-pending", "evaluations-pending"], done: ["papers-done", "evaluations-done"] },
    sql: `
      WITH ps AS (
        SELECT q."examId",
               bool_or(q.status::text IN ('APPROVED', 'PUBLISHED')) AS approved,
               bool_or(q.status::text = 'PENDING_APPROVAL') AS waiting,
               bool_or(q.status::text = 'REJECTED') AS rejected
        FROM viaexam_question_papers q
        WHERE q."instituteId" = :inst AND q."teacherId" = :id AND q."deletedAt" IS NULL
        GROUP BY q."examId"
      )
      SELECT CASE WHEN ps.approved THEN 'papers-done' ELSE 'papers-pending' END AS grp, 1 AS rank,
             COALESCE(e."examDate"::timestamptz, e."createdAt") AS at, 'p:' || e."examId" AS key, ${EXAM_COLUMNS},
             CASE WHEN ps.approved THEN 'approved' WHEN ps.waiting THEN 'waiting' WHEN ps.rejected THEN 'sent-back'
                  WHEN ps."examId" IS NOT NULL THEN 'draft' ELSE 'not-started' END AS paper,
             NULL::timestamptz AS "assignedAt", NULL::timestamptz AS "reviewedAt"
      FROM viaexam_exams e LEFT JOIN ps ON ps."examId" = e."examId" ${EXAM_NAMES}
      WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."teacherId" = :id ${IN_SCOPE}
      UNION ALL
      SELECT CASE WHEN a."reviewedAt" IS NULL THEN 'evaluations-pending' ELSE 'evaluations-done' END, 2,
             COALESCE(a."reviewedAt", a."createdAt"), 'e:' || a."assignmentId", ${EXAM_COLUMNS},
             NULL, a."createdAt", a."reviewedAt"
      FROM viaexam_evaluation_assignments a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
      WHERE a."instituteId" = :inst AND a."teacherId" = :id AND a."isActive" = true ${IN_SCOPE}`,
  },
  SCANNER: {
    groups: { pending: ["scan-pending"], done: ["scan-done"] },
    sql: `
      SELECT CASE WHEN a.status = 'COMPLETED' THEN 'scan-done' ELSE 'scan-pending' END AS grp, 1 AS rank,
             CASE WHEN a.status = 'COMPLETED' THEN COALESCE(a."completedAt", a."createdAt") ELSE a."createdAt" END AS at,
             'a:' || a."assignmentId" AS key, ${EXAM_COLUMNS},
             a.status, a."createdAt" AS "assignedAt", a."completedAt"
      FROM viaexam_exam_scanner_assignments a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
      WHERE a."instituteId" = :inst AND a."scannerId" = :id AND a."isActive" = true ${IN_SCOPE}`,
  },
  STUDENT: {
    groups: { pending: ["awaiting-result", "rechecks-pending"], done: ["results", "rechecks-done"] },
    sql: `
      SELECT 'results' AS grp, 1 AS rank, res."publishedAt" AS at, 'r:' || res."resultId" AS key, ${EXAM_COLUMNS},
             res."marksObtained", res."totalMarks", res.percentage, res.grade, res."resultStatus"::text, res."publishedAt",
             NULL::timestamptz AS "assignedAt"
      FROM viaexam_student_results res JOIN viaexam_exams e ON e."examId" = res."examId" ${EXAM_NAMES}
      WHERE res."instituteId" = :inst AND res."studentId" = :id AND res."isDeleted" = false
        AND res."publishedAt" IS NOT NULL ${IN_SCOPE}
      UNION ALL
      SELECT 'awaiting-result' AS grp, 1 AS rank, COALESCE(e."examDate"::timestamptz, e."createdAt") AS at, 'ex:' || e."examId" AS key, ${EXAM_COLUMNS},
             NULL::numeric AS "marksObtained", NULL::numeric AS "totalMarks", NULL::numeric AS percentage, NULL::text AS grade,
             'Awaiting Result'::text AS "resultStatus", NULL::timestamptz AS "publishedAt",
             e."createdAt" AS "assignedAt"
      FROM viaexam_exams e ${EXAM_NAMES}
      WHERE ${STUDENT_EXAMS} ${IN_SCOPE}
        AND NOT EXISTS (
          SELECT 1 FROM viaexam_student_results res
          WHERE res."examId" = e."examId" AND res."studentId" = :id
            AND res."isDeleted" = false AND res."publishedAt" IS NOT NULL
        )
      UNION ALL
      SELECT CASE WHEN q.status::text IN ('Pending', 'Under Review', 'Approved') THEN 'rechecks-pending' ELSE 'rechecks-done' END AS grp,
             2 AS rank, COALESCE(q."updatedAt", q."createdAt") AS at, 'rq:' || q."requestId" AS key, ${EXAM_COLUMNS},
             NULL::numeric AS "marksObtained", NULL::numeric AS "totalMarks", NULL::numeric AS percentage, NULL::text AS grade,
             q.status::text AS "resultStatus", NULL::timestamptz AS "publishedAt",
             q."createdAt" AS "assignedAt"
      FROM viaexam_recheck_requests q JOIN viaexam_exams e ON e."examId" = q."examId" ${EXAM_NAMES}
      WHERE q."instituteId" = :inst AND q."studentId" = :id ${IN_SCOPE}`,
  },
};

const examRef = (r: any) => ({
  examId: r.examId,
  name: examName(r),
  subjectName: r.subjectName ?? "",
  examType: r.examType ?? "",
  className: r.className ?? "",
  sectionName: r.sectionName ?? "",
  examDate: r.examDate ?? null,
});

const toWorkItem = (role: Role, r: any): WorkItem => {
  const item: WorkItem = { key: r.key, group: r.grp, ...examRef(r) };
  if (role === "TEACHER") return { ...item, paper: r.paper ?? undefined, assignedAt: iso(r.assignedAt), reviewedAt: iso(r.reviewedAt) };
  if (role === "SCANNER") return { ...item, status: r.status, uploaded: num(r.uploaded), assignedAt: iso(r.assignedAt), completedAt: iso(r.completedAt) };
  return {
    ...item,
    marks: num(r.marksObtained),
    total: num(r.totalMarks),
    percentage: r.percentage == null ? null : Number(r.percentage),
    grade: r.grade ?? null,
    passed: r.resultStatus === "PASS",
    resultStatus: r.resultStatus ?? null,
    publishedAt: iso(r.publishedAt),
    assignedAt: iso(r.assignedAt),
  };
};

/** Rows per work group (all groups, both panels). */
const workCounts = async (ctx: Ctx) => {
  const rows = await select<{ grp: string; n: number }>(`SELECT grp, COUNT(*)::int AS n FROM (${WORK[ctx.role].sql}) w GROUP BY grp`, ctx.r);
  return Object.fromEntries(rows.map((x) => [x.grp, num(x.n)])) as Record<string, number>;
};

const workPage = async (
  ctx: Ctx,
  status: WorkStatus,
  opts: { cursor?: string | null; limit?: unknown; group?: string | null },
  counts?: Record<string, number>,
): Promise<Page<WorkItem>> => {
  const spec = WORK[ctx.role];
  const all = spec.groups[status];
  if (opts.group && !all.includes(opts.group)) throw new BadRequest("Unknown work group.");
  // One group only, when asked; counts still cover every group of this status (for the filter).
  const groups = opts.group ? [opts.group] : all;
  const limit = pageSize(opts.limit);
  const cursor = decodeCursor(opts.cursor, ["rank", "at", "key"]);
  if (!groups.length) return { items: [], nextCursor: null, total: cursor ? null : 0, counts: cursor ? null : {} };

  const rows = await select(
    `SELECT * FROM (
       SELECT w.*, date_trunc('milliseconds', w.at) AS t FROM (${spec.sql}) w
     ) w
     WHERE w.grp IN (:groups) AND w.t IS NOT NULL
       ${cursor ? `AND (w.rank > :cRank OR (w.rank = :cRank AND (w.t, w.key) < (CAST(:cAt AS timestamptz), :cKey)))` : ""}
     ORDER BY w.rank ASC, w.t DESC, w.key DESC
     LIMIT :limit`,
    { ...ctx.r, groups, limit: limit + 1, cRank: cursor?.rank, cAt: cursor?.at, cKey: cursor?.key },
  );
  const more = rows.length > limit;
  const pageRows = rows.slice(0, limit);

  // Sheets uploaded so far, for the scanner's rows on this page only.
  if (ctx.role === "SCANNER" && pageRows.length) {
    const ids = [...new Set(pageRows.map((x: any) => x.examId))];
    const up = await select<{ examId: string; n: number }>(
      `SELECT "examId", COUNT(*)::int AS n FROM viaexam_answer_sheets WHERE "examId" IN (:ids) AND "isDeleted" = false GROUP BY "examId"`,
      { ids },
    );
    const byExam = new Map(up.map((x) => [x.examId, num(x.n)]));
    for (const x of pageRows as any[]) x.uploaded = byExam.get(x.examId) ?? 0;
  }

  const last: any = pageRows[pageRows.length - 1];
  const known = cursor ? null : (counts ?? (await workCounts(ctx)));
  return {
    items: pageRows.map((x) => toWorkItem(ctx.role, x)),
    nextCursor: more && last ? encodeCursor({ rank: num(last.rank), at: iso(last.t), key: last.key }) : null,
    total: known ? groups.reduce((n, g) => n + (known[g] ?? 0), 0) : null,
    counts: known ? Object.fromEntries(all.map((g) => [g, known[g] ?? 0])) : null,
  };
};

// ─── History ──────────────────────────────────────────────────────────────────

export type Tone = "blue" | "green" | "amber" | "rose" | "violet" | "cyan" | "slate";

export interface HistoryEvent {
  key: string;
  at: string;
  kind: string;
  title: string;
  detail?: string | null;
  tone: Tone;
  examId?: string | null;
}

/**
 * Every event as one SQL list: at, kind, ev (what happened), a unique key, the exam's
 * names, and up to four text extras (x1..x4) that the title or detail needs.
 * Rows with several moments (a paper started, sent, approved…) unpivot with VALUES.
 */
const historySql = (ctx: Ctx) => {
  // Joining and sign-ins aren't tied to an exam: they show for a session by date, and not
  // at all once one exam (Mid Term / Final) is picked.
  const notExam = (col: string) => (ctx.r.examType ? "AND false" : inRange(col, ctx.ranged));
  const common = `
    SELECT u."createdAt" AS at, 'account' AS kind, 'account' AS ev, 'acc' AS key, ${NO_EXAM},
           NULL::text AS "className", NULL::text AS "sectionName", NULL::text AS "subjectName",
           u."emailId"::text AS x1, NULL::text AS x2, NULL::text AS x3, NULL::text AS x4
    FROM viaexam_users u WHERE u."userId" = :id ${notExam(`u."createdAt"`)}
    UNION ALL
    SELECT l."createdAt", 'sign-in', 'sign-in', 'l:' || l.id, ${NO_EXAM}, NULL, NULL, NULL, ${X(4)}
    FROM viaexam_activity_logs l
    WHERE l."userId" = :id AND l."instituteId" = :inst AND l."eventType" = 'LOGIN_SUCCESS' ${notExam(`l."createdAt"`)}`;

  if (ctx.role === "TEACHER")
    return `${common}
    UNION ALL
    SELECT e."createdAt", 'exam', 'exam-set', 'x:' || e."examId", ${EXAM_COLUMNS}, ${X(4)}
    FROM viaexam_exams e ${EXAM_NAMES}
    WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."teacherId" = :id ${IN_SCOPE}
    UNION ALL
    SELECT v.at, 'paper', v.ev, v.ev || ':' || q."paperId", ${EXAM_COLUMNS}, q.paper_set::text, q."rejectionNote"::text, NULL, NULL
    FROM viaexam_question_papers q JOIN viaexam_exams e ON e."examId" = q."examId" ${EXAM_NAMES}
    CROSS JOIN LATERAL (VALUES (q."createdAt", 'paper-start'), (q."submittedAt", 'paper-sent'),
                               (q."approvedAt", 'paper-approved'), (q."rejectedAt", 'paper-rejected')) v(at, ev)
    WHERE q."instituteId" = :inst AND q."teacherId" = :id AND q."deletedAt" IS NULL AND v.at IS NOT NULL ${IN_SCOPE}
    UNION ALL
    SELECT v.at, 'evaluation', v.ev, v.ev || ':' || a."assignmentId", ${EXAM_COLUMNS}, ${X(4)}
    FROM viaexam_evaluation_assignments a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
    CROSS JOIN LATERAL (VALUES (a."createdAt", 'eval-assigned'), (a."reviewedAt", 'eval-done'), (a."unassignedAt", 'eval-removed')) v(at, ev)
    WHERE a."instituteId" = :inst AND a."teacherId" = :id AND v.at IS NOT NULL ${IN_SCOPE}
    UNION ALL
    SELECT v.at, 'recheck', v.ev, v.ev || ':' || ra."requestId", ${EXAM_COLUMNS},
           u."userName"::text, ra."previousScore"::text, ra."revisedScore"::text, NULL
    FROM viaexam_recheck_assignments ra
    JOIN viaexam_recheck_requests rr ON rr."requestId" = ra."requestId"
    JOIN viaexam_exams e ON e."examId" = ra."examId" ${EXAM_NAMES}
    LEFT JOIN viaexam_users u ON u."userId" = rr."studentId"
    CROSS JOIN LATERAL (VALUES (ra."assignedAt", 'recheck-assigned'), (ra."completedAt", 'recheck-finished')) v(at, ev)
    WHERE ra."instituteId" = :inst AND ra."teacherId" = :id AND v.at IS NOT NULL ${IN_SCOPE}`;

  if (ctx.role === "SCANNER")
    return `${common}
    UNION ALL
    SELECT v.at, 'scan', v.ev, v.ev || ':' || a."assignmentId", ${EXAM_COLUMNS}, a.note::text, NULL, NULL, NULL
    FROM viaexam_exam_scanner_assignments a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
    CROSS JOIN LATERAL (VALUES (a."createdAt", 'scan-assigned'), (a."completedAt", 'scan-done'), (a."unassignedAt", 'scan-removed')) v(at, ev)
    WHERE a."instituteId" = :inst AND a."scannerId" = :id AND v.at IS NOT NULL ${IN_SCOPE}
    UNION ALL
    -- Uploads grouped per exam and day: one line instead of one per sheet.
    SELECT MAX(s."createdAt"), 'upload', 'upload', 'u:' || COALESCE(s."examId", '-') || ':' || ((s."createdAt")::date)::text,
           ${EXAM_COLUMNS}, COUNT(*)::text, NULL, NULL, NULL
    FROM viaexam_answer_sheets s LEFT JOIN viaexam_exams e ON e."examId" = s."examId" ${EXAM_NAMES}
    WHERE s."instituteId" = :inst AND s."uploadedBy" = :id AND s."isDeleted" = false ${IN_SCOPE}
    GROUP BY s."examId", (s."createdAt")::date, e."examId", e."examType", e."examDate", c."className", sec."sectionName", sub."subjectName"`;

  return `${common}
    UNION ALL
    SELECT en."createdAt", 'class', 'class-joined', 'cls:' || en."enrollmentId", ${NO_EXAM}, c."className", s."sectionName", NULL,
           se."sessionName"::text, en."rollNumber"::text, NULL, NULL
    FROM viaexam_student_enrollments en
    JOIN viaexam_sessions se ON se."sessionId" = en."sessionId"
    LEFT JOIN viaexam_classes c ON c."classId" = en."classId"
    LEFT JOIN viaexam_sections s ON s."sectionId" = en."sectionId"
    WHERE en."studentId" = :id AND (:session = '' OR en."sessionId" = :session) ${ctx.r.examType ? "AND false" : ""}
    UNION ALL
    SELECT s."createdAt", 'upload', 'sheet', 's:' || s."sheetId", ${EXAM_COLUMNS}, u."userName"::text, NULL, NULL, NULL
    FROM viaexam_answer_sheets s JOIN viaexam_exams e ON e."examId" = s."examId" ${EXAM_NAMES}
    LEFT JOIN viaexam_users u ON u."userId" = s."uploadedBy"
    WHERE ${STUDENT_SHEETS} ${IN_SCOPE}
    UNION ALL
    SELECT a."updatedAt", 'evaluation', CASE WHEN a.status = 'Success' THEN 'ai-done' ELSE 'ai-failed' END, 'ai:' || a.id,
           ${EXAM_COLUMNS}, a."totalScore"::text, NULL, NULL, NULL
    FROM viaexam_ai_evaluations a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
    WHERE a."studentId" = :id AND e."instituteId" = :inst AND a.status IN ('Success', 'Failed') ${IN_SCOPE}
    UNION ALL
    SELECT a."createdAt", 'attendance', 'absent', 'ab:' || a."attendanceId", ${EXAM_COLUMNS}, ${X(4)}
    FROM viaexam_exam_attendance a JOIN viaexam_exams e ON e."examId" = a."examId" ${EXAM_NAMES}
    WHERE a."instituteId" = :inst AND a."studentId" = :id AND a.status = 'ABSENT' ${IN_SCOPE}
    UNION ALL
    SELECT v.at, 'result', v.ev, v.ev || ':' || res."resultId", ${EXAM_COLUMNS},
           res."marksObtained"::text, res."totalMarks"::text, res.grade::text, res."resultStatus"::text
    FROM viaexam_student_results res JOIN viaexam_exams e ON e."examId" = res."examId" ${EXAM_NAMES}
    CROSS JOIN LATERAL (VALUES (res."publishedAt", 'result-published'), (res."revisedAt", 'result-revised')) v(at, ev)
    WHERE res."instituteId" = :inst AND res."studentId" = :id AND res."isDeleted" = false AND v.at IS NOT NULL ${IN_SCOPE}
    UNION ALL
    SELECT v.at, 'recheck', v.ev, v.ev || ':' || q."requestId", ${EXAM_COLUMNS}, q.reason::text, NULL, NULL, NULL
    FROM viaexam_recheck_requests q JOIN viaexam_exams e ON e."examId" = q."examId" ${EXAM_NAMES}
    CROSS JOIN LATERAL (VALUES (q."createdAt", 'recheck-asked'),
                               (CASE WHEN q.status::text = 'Rejected' THEN q."reviewedAt" END, 'recheck-declined'),
                               (q."completedAt", 'recheck-done')) v(at, ev)
    WHERE q."instituteId" = :inst AND q."studentId" = :id AND v.at IS NOT NULL ${IN_SCOPE}`;
};

const place = (className?: string | null, sectionName?: string | null) =>
  className ? `Class ${className}${sectionName ? `-${sectionName}` : ""}` : "";
/** "Mathematics · Mid Term · Class 9-A" */
const examName = (r: any) => [r.subjectName || "Subject", r.examType, place(r.className, r.sectionName)].filter(Boolean).join(" · ");
const joined = (...parts: unknown[]) => parts.filter(Boolean).join(" — ") || null;

/** Title, detail and colour for one history row. */
const describe = (h: any): Pick<HistoryEvent, "title" | "detail" | "tone"> => {
  const exam = h.examId ? examName(h) : null;
  const set = h.x1 ? `Set ${h.x1}` : "Paper";
  switch (h.ev) {
    case "account": return { tone: "green", title: "Added to the school", detail: h.x1 };
    case "sign-in": return { tone: "slate", title: "Signed in", detail: null };
    case "exam-set": return { tone: "blue", title: "Asked to set a paper", detail: exam };
    case "paper-start": return { tone: "slate", title: `Started ${set}`, detail: exam };
    case "paper-sent": return { tone: "amber", title: `Sent ${set} for approval`, detail: exam };
    case "paper-approved": return { tone: "green", title: `${set} approved`, detail: exam };
    case "paper-rejected": return { tone: "rose", title: `${set} sent back`, detail: joined(exam, h.x2) };
    case "eval-assigned": return { tone: "violet", title: "Made evaluator", detail: exam };
    case "eval-done": return { tone: "green", title: "Finished checking the marks", detail: exam };
    case "eval-removed": return { tone: "slate", title: "Removed as evaluator", detail: exam };
    case "recheck-assigned": return { tone: "blue", title: `Asked to recheck ${h.x1 || "a student"}'s sheet`, detail: exam };
    case "recheck-finished": return { tone: "green", title: "Finished a recheck", detail: `${exam} — ${h.x2 ?? "?"} → ${h.x3 ?? "?"}` };
    case "scan-assigned": return { tone: "cyan", title: "Asked to scan an exam", detail: joined(exam, h.x1) };
    case "scan-done": return { tone: "green", title: "Finished scanning", detail: exam };
    case "scan-removed": return { tone: "slate", title: "Taken off the exam", detail: exam };
    case "upload": {
      const n = num(h.x1);
      return { tone: "blue", title: `Uploaded ${n} answer ${n === 1 ? "sheet" : "sheets"}`, detail: exam };
    }
    case "class-joined":
      return { tone: "violet", title: `Joined ${place(h.className, h.sectionName) || "a class"}`, detail: h.x1 ? `Session ${h.x1}, roll ${h.x2 ?? ""}` : null };
    case "sheet": return { tone: "blue", title: "Answer sheet uploaded", detail: joined(exam, h.x1 && `by ${h.x1}`) };
    case "ai-done": return { tone: "violet", title: `Marked by AI: ${h.x1 ?? "?"} marks`, detail: exam };
    case "ai-failed": return { tone: "rose", title: "AI couldn't read the sheet", detail: exam };
    case "absent": return { tone: "amber", title: "Marked absent", detail: exam };
    case "result-published":
      return { tone: h.x4 === "FAIL" ? "rose" : "green", title: `Result published: ${num(h.x1)}/${num(h.x2)}${h.x3 ? ` (${h.x3})` : ""}`, detail: exam };
    case "result-revised": return { tone: "blue", title: `Marks changed to ${num(h.x1)}`, detail: exam };
    case "recheck-asked": return { tone: "amber", title: "Asked for a recheck", detail: joined(exam, h.x1) };
    case "recheck-declined": return { tone: "rose", title: "Recheck declined", detail: exam };
    case "recheck-done": return { tone: "green", title: "Recheck done", detail: exam };
    default: return { tone: "slate", title: String(h.ev ?? "Activity"), detail: exam };
  }
};

const KIND_RULE = /^[a-z-]{1,24}$/;

const historyPage = async (ctx: Ctx, opts: { cursor?: string | null; limit?: unknown; kind?: string | null }): Promise<Page<HistoryEvent>> => {
  const limit = pageSize(opts.limit);
  const cursor = decodeCursor(opts.cursor, ["at", "key"]);
  const kind = opts.kind ?? "";
  if (kind && !KIND_RULE.test(kind)) throw new BadRequest("Unknown activity type.");
  const events = `SELECT h.*, date_trunc('milliseconds', h.at) AS t FROM (${historySql(ctx)}) h WHERE h.at IS NOT NULL`;
  const r = { ...ctx.r, kind, limit: limit + 1, cAt: cursor?.at, cKey: cursor?.key };

  const [rows, kinds] = await Promise.all([
    select(
      `SELECT * FROM (${events}) h
       WHERE (:kind = '' OR h.kind = :kind)
         ${cursor ? `AND (h.t, h.key) < (CAST(:cAt AS timestamptz), :cKey)` : ""}
       ORDER BY h.t DESC, h.key DESC
       LIMIT :limit`,
      r,
    ),
    cursor ? Promise.resolve(null) : select<{ kind: string; n: number }>(`SELECT kind, COUNT(*)::int AS n FROM (${events}) h GROUP BY kind`, r),
  ]);
  const more = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last: any = pageRows[pageRows.length - 1];
  const counts = kinds ? (Object.fromEntries(kinds.map((x) => [x.kind, num(x.n)])) as Record<string, number>) : null;
  return {
    items: pageRows.map((h: any) => ({ key: h.key, at: iso(h.t)!, kind: h.kind, examId: h.examId ?? null, ...describe(h) })),
    nextCursor: more && last ? encodeCursor({ at: iso(last.t), key: last.key }) : null,
    total: counts ? (kind ? (counts[kind] ?? 0) : Object.values(counts).reduce((a, b) => a + b, 0)) : null,
    counts,
  };
};

// ─── Profile and numbers ──────────────────────────────────────────────────────

const teacherSummary = async (r: Record<string, unknown>) => {
  const [[profile], subjects, classTeacherOf, [n]] = await Promise.all([
    select(`SELECT "teacherType", qualification, specialization, experience, address, "joiningDate", dob, "isExaminer"
            FROM viaexam_teacher_profiles WHERE "userId" = :id`, r),
    select(`SELECT sub."subjectId", sub."subjectName", c."className"
            FROM viaexam_session_subjects ss
            JOIN viaexam_subjects sub ON sub."subjectId" = ss."subjectId" AND sub."isDeleted" = false
            LEFT JOIN viaexam_classes c ON c."classId" = sub."classId"
            WHERE ss."instituteId" = :inst AND ss."sessionId" = :teachSession AND ss."teacherId" = :id
            ORDER BY c."className", sub."subjectName"
            LIMIT 500`, r),
    select(`SELECT s."sectionId", s."sectionName", c."className"
            FROM viaexam_session_sections ss
            JOIN viaexam_sections s ON s."sectionId" = ss."sectionId"
            LEFT JOIN viaexam_classes c ON c."classId" = s."classId"
            WHERE ss."instituteId" = :inst AND ss."sessionId" = :teachSession AND ss."classTeacherId" = :id`, r),
    select(`SELECT
      (SELECT COUNT(*) FROM viaexam_session_subjects ss WHERE ss."instituteId" = :inst AND ss."sessionId" = :teachSession AND ss."teacherId" = :id)::int AS subjects,
      (SELECT COUNT(*) FROM viaexam_exams e WHERE e."instituteId" = :inst AND e."isDeleted" = false AND e."teacherId" = :id ${IN_SCOPE})::int AS "examsToSet",
      (SELECT COUNT(*) FILTER (WHERE q.status::text IN ('APPROVED', 'PUBLISHED'))
         FROM viaexam_question_papers q JOIN viaexam_exams e ON e."examId" = q."examId"
         WHERE q."instituteId" = :inst AND q."teacherId" = :id AND q."deletedAt" IS NULL ${IN_SCOPE})::int AS "papersApproved",
      (SELECT COUNT(*) FILTER (WHERE q.status::text = 'PENDING_APPROVAL')
         FROM viaexam_question_papers q JOIN viaexam_exams e ON e."examId" = q."examId"
         WHERE q."instituteId" = :inst AND q."teacherId" = :id AND q."deletedAt" IS NULL ${IN_SCOPE})::int AS "papersWaiting",
      (SELECT COUNT(*) FROM viaexam_evaluation_assignments a JOIN viaexam_exams e ON e."examId" = a."examId"
         WHERE a."instituteId" = :inst AND a."teacherId" = :id AND a."isActive" = true AND a."reviewedAt" IS NULL ${IN_SCOPE})::int AS "evaluationsOpen",
      (SELECT COUNT(*) FROM viaexam_evaluation_assignments a JOIN viaexam_exams e ON e."examId" = a."examId"
         WHERE a."instituteId" = :inst AND a."teacherId" = :id AND a."reviewedAt" IS NOT NULL ${IN_SCOPE})::int AS "evaluationsDone",
      (SELECT COUNT(*) FROM viaexam_recheck_assignments ra JOIN viaexam_exams e ON e."examId" = ra."examId"
         WHERE ra."instituteId" = :inst AND ra."teacherId" = :id AND ra."completedAt" IS NULL ${IN_SCOPE})::int AS "rechecksOpen"`, r),
  ]);
  return {
    profile: profile
      ? {
          teacherType: profile.teacherType ?? null,
          qualification: profile.qualification ?? null,
          specialization: profile.specialization ?? null,
          experience: profile.experience ?? null,
          address: profile.address ?? null,
          joiningDate: profile.joiningDate ?? null,
          dob: profile.dob ?? null,
          isExaminer: Boolean(profile.isExaminer),
        }
      : null,
    numbers: {
      subjects: num(n?.subjects),
      examsToSet: num(n?.examsToSet),
      papersApproved: num(n?.papersApproved),
      papersWaiting: num(n?.papersWaiting),
      evaluationsOpen: num(n?.evaluationsOpen),
      evaluationsDone: num(n?.evaluationsDone),
      rechecksOpen: num(n?.rechecksOpen),
    },
    teaches: subjects.map((s) => ({ subjectId: s.subjectId, subjectName: s.subjectName, className: s.className ?? "" })),
    classTeacherOf: classTeacherOf.map((s) => ({ sectionId: s.sectionId, label: place(s.className, s.sectionName) })),
  };
};

const scannerSummary = async (r: Record<string, unknown>) => {
  const [[profile], [a], [s]] = await Promise.all([
    select(`SELECT address, dob, gender FROM viaexam_scanner_profiles WHERE "userId" = :id`, r),
    select(`SELECT COUNT(*) FILTER (WHERE a.status <> 'COMPLETED')::int AS open, COUNT(*) FILTER (WHERE a.status = 'COMPLETED')::int AS finished
            FROM viaexam_exam_scanner_assignments a JOIN viaexam_exams e ON e."examId" = a."examId"
            WHERE a."instituteId" = :inst AND a."scannerId" = :id AND a."isActive" = true ${IN_SCOPE}`, r),
    select(`SELECT COUNT(*)::int AS n, MAX(s."createdAt") AS last
            FROM viaexam_answer_sheets s LEFT JOIN viaexam_exams e ON e."examId" = s."examId"
            WHERE s."instituteId" = :inst AND s."uploadedBy" = :id AND s."isDeleted" = false ${IN_SCOPE}`, r),
  ]);
  return {
    profile: profile ? { address: profile.address ?? null, dob: profile.dob ?? null, gender: profile.gender ?? null } : null,
    numbers: { open: num(a?.open), finished: num(a?.finished), sheets: num(s?.n), lastUpload: iso(s?.last) },
  };
};

const studentSummary = async (r: Record<string, unknown>, profile: any) => {
  const [[n]] = await Promise.all([
    select(`SELECT
      (SELECT COUNT(*) FROM viaexam_exams e WHERE ${STUDENT_EXAMS} ${IN_SCOPE})::int AS exams,
      (SELECT COUNT(*) FROM viaexam_answer_sheets s JOIN viaexam_exams e ON e."examId" = s."examId"
         WHERE ${STUDENT_SHEETS} ${IN_SCOPE})::int AS sheets,
      (SELECT COUNT(*) FROM viaexam_student_results res JOIN viaexam_exams e ON e."examId" = res."examId"
         WHERE res."instituteId" = :inst AND res."studentId" = :id AND res."isDeleted" = false AND res."publishedAt" IS NOT NULL ${IN_SCOPE})::int AS results,
      (SELECT ROUND(AVG(res.percentage)::numeric, 1) FROM viaexam_student_results res JOIN viaexam_exams e ON e."examId" = res."examId"
         WHERE res."instituteId" = :inst AND res."studentId" = :id AND res."isDeleted" = false AND res."publishedAt" IS NOT NULL
           AND res.percentage IS NOT NULL ${IN_SCOPE}) AS average,
      (SELECT COUNT(*) FROM viaexam_exam_attendance a JOIN viaexam_exams e ON e."examId" = a."examId"
         WHERE a."instituteId" = :inst AND a."studentId" = :id AND a.status = 'ABSENT' ${IN_SCOPE})::int AS absent,
      (SELECT COUNT(*) FROM viaexam_recheck_requests q JOIN viaexam_exams e ON e."examId" = q."examId"
         WHERE q."instituteId" = :inst AND q."studentId" = :id AND q.status::text IN ('Pending', 'Under Review', 'Approved') ${IN_SCOPE})::int AS "rechecksOpen"`, r),
  ]);
  return {
    profile: profile
      ? {
          classId: profile.classId,
          sectionId: profile.sectionId,
          className: profile.className ?? "",
          sectionName: profile.sectionName ?? "",
          rollNumber: profile.rollNumber ?? "",
          session: profile.session ?? "",
          /** False when the student wasn't in the school in the chosen session. */
          enrolled: Boolean(profile.classId),
          classTeacher: profile.classTeacher ?? null,
          fatherName: profile.fatherName ?? null,
          gender: profile.gender ?? null,
          dob: profile.dob ?? null,
          address: profile.address ?? null,
          active: Boolean(profile.isActive),
        }
      : null,
    numbers: {
      exams: num(n?.exams),
      sheets: num(n?.sheets),
      results: num(n?.results),
      average: n?.average == null ? null : Number(n.average),
      absent: num(n?.absent),
      rechecksOpen: num(n?.rechecksOpen),
    },
  };
};

// ─── Entry ────────────────────────────────────────────────────────────────────

export interface PersonQuery {
  /** A sessionId, "all", or empty for the current session. */
  sessionId?: string | null;
  /** "Mid Term" / "Final" (or an alias such as "half yearly"); empty for every exam. */
  examType?: string | null;
}
export interface ListQuery extends PersonQuery {
  cursor?: string | null;
  limit?: unknown;
}

const NOT_FOUND = { error: true, statusCode: httpStatus.NOT_FOUND, message: "This person was not found in your school." };

const failed = (e: any, what: string, message: string) => {
  if (e instanceof BadRequest) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: e.message };
  logger.error(`[Home] ${what}: ${e?.message || e}`);
  return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message };
};

const getPerson = async (user: any, userId: string, query: PersonQuery = {}) => {
  try {
    const ctx = await context(user, userId, query);
    if (!ctx) return NOT_FOUND;
    const { base, role, r } = ctx;

    const [summary, counts, history, [last]] = await Promise.all([
      role === "TEACHER" ? teacherSummary(r) : role === "SCANNER" ? scannerSummary(r) : studentSummary(r, ctx.studentProfile),
      workCounts(ctx),
      historyPage(ctx, {}),
      select(LAST_SIGN_IN_SQL, r),
    ]);
    const [pending, done] = await Promise.all([workPage(ctx, "pending", {}, counts), workPage(ctx, "done", {}, counts)]);

    const lastSignIn = [base.presenceLoginAt, base.lastLoginAt, last?.at].filter(Boolean).map((d) => new Date(d).getTime());
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Person loaded.",
      data: {
        userId: base.userId,
        name: base.userName ?? "",
        role,
        email: base.emailId ?? "",
        phone: base.phoneNumber ?? "",
        photo: base.profileUrl ?? null,
        status: num(base.status),
        addedAt: iso(base.createdAt),
        updatedAt: iso(base.updatedAt),
        lastSignIn: lastSignIn.length ? new Date(Math.max(...lastSignIn)).toISOString() : null,
        online: base.presenceStatus === "ONLINE" && base.lastActivityAt && Date.now() - new Date(base.lastActivityAt).getTime() < 15 * 60_000,
        ...summary,
        // Numbers, work and history are for this session ("all" = every session) and exam.
        sessionId: ctx.session?.sessionId ?? ALL_SESSIONS,
        sessions: ctx.sessions.map((s) => ({
          sessionId: s.sessionId,
          sessionName: s.sessionName,
          isActive: Boolean(s.isActive),
          startDate: iso(s.startDate),
          endDate: iso(s.endDate),
        })),
        // The exam the page is narrowed to (null = every exam), and the ones a school runs.
        examType: (ctx.r.examType as string) || null,
        examTypes: EXAM_TYPES,
        work: { pending, done },
        history,
      },
    };
  } catch (e: any) {
    return failed(e, "person", "Could not load this person.");
  }
};

/** GET /v1/home/people/:userId/work?status=pending|done&group= — a page of work (one group, optionally). */
const getPersonWork = async (user: any, userId: string, query: ListQuery & { status?: string | null; group?: string | null }) => {
  try {
    if (query.status !== "pending" && query.status !== "done") return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "status must be pending or done." };
    const ctx = await context(user, userId, query);
    if (!ctx) return NOT_FOUND;
    const data = await workPage(ctx, query.status, query);
    return { error: false, statusCode: httpStatus.OK, message: "Work loaded.", data };
  } catch (e: any) {
    return failed(e, "person work", "Could not load this work.");
  }
};

/** GET /v1/home/people/:userId/history?kind= — the next page of the activity log. */
const getPersonHistory = async (user: any, userId: string, query: ListQuery & { kind?: string | null }) => {
  try {
    const ctx = await context(user, userId, query);
    if (!ctx) return NOT_FOUND;
    const data = await historyPage(ctx, query);
    return { error: false, statusCode: httpStatus.OK, message: "History loaded.", data };
  } catch (e: any) {
    return failed(e, "person history", "Could not load the activity log.");
  }
};

export default { getPerson, getPersonWork, getPersonHistory };
