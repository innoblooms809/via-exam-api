import httpStatus from "http-status";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import config from "../../config/config";
import logger from "../../config/logger";
import { isStripeConfigured } from "../../config/stripe";
import { getFirebaseMessaging } from "../../config/firebase";
import { ANSWER_SHEET_LIMITS } from "../../config/uploadLimits";
import { memoize } from "../../utils/memoCache";

// Detail reports behind the super admin dashboard cards. Every list is paged in SQL
// (LIMIT/OFFSET + COUNT(*) OVER()), aggregates are computed with one GROUP BY per
// table instead of a sub-query per row, and every filter value is a bound
// replacement. Sort columns and time windows come from whitelists only.

const TZ = "Asia/Kolkata";
const CACHE_MS = 30_000;
const MAX_LIMIT = 100;
const ONLINE_WINDOW_MINUTES = 30;
const RENEWAL_WINDOW_DAYS = 7;

const currency = () => String(config.stripe.currency || "inr").toLowerCase();

// Same rules as the dashboard summary (superAdminDashboard.service).
const EFFECTIVE_STATUS = `
  CASE
    WHEN s.status = 'trialing' AND (s."trialEndsAt" IS NULL OR s."trialEndsAt" <= now()) THEN 'expired'
    WHEN s.status = 'active' AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd" <= now()) THEN 'expired'
    ELSE s.status
  END`;
const ACCESS_ENDS_AT = `CASE s.status WHEN 'trialing' THEN s."trialEndsAt" WHEN 'active' THEN s."currentPeriodEnd" END`;
const EVALUATED_SHEET = `('Evaluated', 'Processed')`;

type Row = Record<string, any>;
type Query = Record<string, unknown>;

const ok = (message: string, data: unknown) => ({ error: false, statusCode: httpStatus.OK, message, data });
const fail = (scope: string, e: any) => {
  logger.error(`[SuperAdminReports] ${scope}: ${e?.message || e}`);
  return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not load this report." };
};

const num = (v: unknown) => Number(v) || 0;
const str = (v: unknown, max = 100) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

/** `%term%` for ILIKE with the LIKE wildcards in the term escaped. */
const like = (term: string) => `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const paging = (query: Query, defaultLimit = 25) => {
  const page = Math.max(1, Math.floor(num(query.page)) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(num(query.limit)) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
};

const pagination = (total: number, page: number, limit: number) => ({
  total,
  page,
  limit,
  totalPages: Math.ceil(total / limit),
});

const RANGES = { "24h": "24 hours", "7d": "7 days", "30d": "30 days", "90d": "90 days", "1y": "1 year", all: null } as const;
type RangeKey = keyof typeof RANGES;
const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

/** Start of a rolling window ("7d" → now − 7 days), or the epoch for "all". */
const sinceOf = (range: RangeKey) => {
  const interval = RANGES[range];
  if (!interval) return new Date(0);
  const [n, unit] = interval.split(" ");
  const ms = { hours: 3_600_000, days: 86_400_000, year: 365 * 86_400_000 }[unit] ?? 86_400_000;
  return new Date(Date.now() - Number(n) * ms);
};

/**
 * Runs a paged list query that selects `COUNT(*) OVER() AS total_count`. When the page
 * is past the end (rows were deleted, filters narrowed) it falls back to the first page,
 * so the caller always gets a correct total.
 */
const pagedQuery = async (sql: string, replacements: Row, page: number, limit: number) => {
  const run = (offset: number) =>
    sequelize.query<Row>(sql, { type: QueryTypes.SELECT, replacements: { ...replacements, limit, offset } });
  let rows = await run((page - 1) * limit);
  let current = page;
  if (rows.length === 0 && page > 1) {
    rows = await run(0);
    current = 1;
  }
  const total = rows.length ? num(rows[0].total_count) : 0;
  return {
    rows: rows.map(({ total_count, ...rest }) => rest),
    pagination: pagination(total, current, limit),
  };
};

const daysLeftOf = (status: string | null, endsAt: string | Date | null) => {
  if (!endsAt || (status !== "active" && status !== "trialing")) return null;
  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000));
};

// ─── Why an AI evaluation failed ──────────────────────────────────────────────
// The stored error is whatever the AI service or HTTP client returned. These rules
// turn it into a short reason the super admin can act on.

const FAILURE_REASONS: { key: string; label: string; hint: string; test: RegExp }[] = [
  {
    key: "timeout",
    label: "Timed out",
    hint: "The AI service took too long to answer. Usually temporary; re-run the evaluation.",
    test: /time ?out|timed out|ETIMEDOUT|ESOCKETTIMEDOUT|504|deadline/i,
  },
  {
    key: "unreachable",
    label: "AI service unreachable",
    hint: "The evaluation server could not be reached. Check that the AI service is running.",
    test: /ECONNREFUSED|ENOTFOUND|ECONNRESET|EAI_AGAIN|socket hang up|502|503|bad gateway|service unavailable|network error/i,
  },
  {
    key: "quota",
    label: "AI quota or rate limit",
    hint: "The AI provider refused the request because of a quota or rate limit.",
    test: /429|rate.?limit|quota|too many requests|insufficient_quota|billing/i,
  },
  {
    key: "answer_key",
    label: "Answer key or paper missing",
    hint: "The exam has no approved question paper or standard answer to grade against.",
    test: /standard ?answer|answer ?key|question ?paper|no (exam|paper)|not found.*(exam|paper)/i,
  },
  {
    key: "ocr",
    label: "Sheet could not be read",
    hint: "OCR could not extract text from the scan. Re-scan the sheet at a higher quality.",
    test: /ocr|no text|empty (text|ocr)|could not (read|extract)|unreadable|blank/i,
  },
  {
    key: "file",
    label: "File problem",
    hint: "The uploaded file is missing, corrupt or in a format the AI service rejects.",
    test: /pdf|image|file|buffer|mime|cloudinary|download|corrupt|format/i,
  },
  {
    key: "invalid_response",
    label: "Unexpected AI response",
    hint: "The AI service answered, but not in the expected format.",
    test: /json|parse|unexpected token|invalid response|schema|validation/i,
  },
];
const OTHER_REASON = { key: "other", label: "Other error", hint: "See the full error message for details." };

const reasonOf = (error: string | null | undefined) => {
  if (!error) return OTHER_REASON;
  return FAILURE_REASONS.find((r) => r.test.test(error)) ?? OTHER_REASON;
};

const withReason = <T extends Row>(row: T) => {
  if (row.status !== "Failed" && row.evaluationStatus !== "Failed") return { ...row, reason: null };
  const r = reasonOf(row.error);
  return { ...row, reason: { key: r.key, label: r.label, hint: r.hint } };
};

// ─── Institutes: usage + billing, one row per institute ───────────────────────

const INSTITUTE_SORTS = {
  name: `name`,
  createdAt: `"createdAt"`,
  students: `students`,
  teachers: `teachers`,
  exams: `exams`,
  sheets: `sheets`,
  evaluations: `evaluations`,
  failedEvaluations: `"failedEvaluations"`,
  revenue: `revenue`,
  lastActiveAt: `"lastActiveAt"`,
  accessEndsAt: `"accessEndsAt"`,
} as const;
type InstituteSort = keyof typeof INSTITUTE_SORTS;

const INSTITUTES_SQL = (orderBy: string) => `
WITH live AS (
  SELECT i.id, i."instituteId", i."instituteName" AS name, i.slug, i.city, i.state, i."logoUrl",
         i."contactPersonName", i."contactEmail", i."contactPhone", i.status, i."createdAt"
  FROM viaexam_institutes i
  WHERE i."isDeleted" = false
    AND (:instituteId = '' OR i."instituteId" = :instituteId OR i.id::text = :instituteId)
    AND (:search = '' OR i."instituteName" ILIKE :like OR i.slug ILIKE :like OR i.city ILIKE :like
         OR i."contactEmail" ILIKE :like OR i."contactPersonName" ILIKE :like)
),
st AS (SELECT "instituteId", COUNT(*)::int AS n FROM viaexam_student_profiles GROUP BY 1),
te AS (SELECT "instituteId", COUNT(*)::int AS n FROM viaexam_teacher_profiles GROUP BY 1),
ex AS (SELECT "instituteId", COUNT(*)::int AS n FROM viaexam_exams WHERE "isDeleted" = false GROUP BY 1),
sh AS (
  SELECT "instituteId", COUNT(*)::int AS n, COUNT(*) FILTER (WHERE status IN ${EVALUATED_SHEET})::int AS evaluated
  FROM viaexam_answer_sheets WHERE "isDeleted" = false GROUP BY 1
),
ev AS (
  SELECT x."instituteId", COUNT(*)::int AS n, COUNT(*) FILTER (WHERE e.status = 'Failed')::int AS failed
  FROM viaexam_ai_evaluations e JOIN viaexam_answer_sheets x ON x."sheetId" = e."sheetId"
  GROUP BY 1
),
rv AS (
  SELECT "instituteId", SUM(amount)::float8 AS amount, MAX("paidAt") AS last_paid
  FROM viaexam_subscription_transactions
  WHERE status = 'paid' AND kind <> 'trial' AND amount > 0 AND currency = :currency
  GROUP BY 1
),
la AS (
  SELECT "instituteId", MAX("lastActivityAt") AS last
  FROM viaexam_user_presence_sessions WHERE upper(role) <> 'SUPER_ADMIN' GROUP BY 1
),
rows AS (
  SELECT live.*,
         COALESCE(st.n, 0) AS students, COALESCE(te.n, 0) AS teachers, COALESCE(ex.n, 0) AS exams,
         COALESCE(sh.n, 0) AS sheets, COALESCE(sh.evaluated, 0) AS "evaluatedSheets",
         COALESCE(ev.n, 0) AS evaluations, COALESCE(ev.failed, 0) AS "failedEvaluations",
         COALESCE(rv.amount, 0) AS revenue, rv.last_paid AS "lastPaidAt", la.last AS "lastActiveAt",
         s."planKey", COALESCE(p.name, s."planKey") AS "planName", s."billingCycle",
         ${EFFECTIVE_STATUS} AS "subscriptionStatus", ${ACCESS_ENDS_AT} AS "accessEndsAt"
  FROM live
  LEFT JOIN st ON st."instituteId" = live."instituteId"
  LEFT JOIN te ON te."instituteId" = live."instituteId"
  LEFT JOIN ex ON ex."instituteId" = live."instituteId"
  LEFT JOIN sh ON sh."instituteId" = live."instituteId"
  LEFT JOIN ev ON ev."instituteId" = live."instituteId"
  LEFT JOIN rv ON rv."instituteId" = live."instituteId"
  LEFT JOIN la ON la."instituteId" = live."instituteId"
  LEFT JOIN viaexam_subscriptions s ON s."instituteId" = live."instituteId"
  LEFT JOIN viaexam_plans p ON p."planKey" = s."planKey"
)
SELECT rows.*, COUNT(*) OVER()::int AS total_count
FROM rows
WHERE (:status = '' OR rows."subscriptionStatus" = :status)
  AND (:planKey = '' OR rows."planKey" = :planKey)
ORDER BY ${orderBy}
LIMIT :limit OFFSET :offset`;

const listInstitutes = async (query: Query) => {
  const { page, limit } = paging(query);
  const search = str(query.search);
  const status = pick(query.status, ["", "active", "trialing", "expired", "cancelled"] as const, "");
  const planKey = str(query.planKey, 32).toLowerCase();
  const instituteId = str(query.instituteId, 64);
  const sort = pick(query.sort, Object.keys(INSTITUTE_SORTS) as InstituteSort[], "createdAt");
  const order = pick(query.order, ["asc", "desc"] as const, sort === "name" ? "asc" : "desc");
  const orderBy = `${INSTITUTE_SORTS[sort]} ${order.toUpperCase()} NULLS LAST, name ASC`;

  try {
    const key = `sa-rep:institutes:${JSON.stringify([page, limit, search, status, planKey, instituteId, sort, order])}`;
    const result = await memoize(key, CACHE_MS, () =>
      pagedQuery(
        INSTITUTES_SQL(orderBy),
        { search, like: like(search), status, planKey, instituteId, currency: currency() },
        page,
        limit
      )
    );
    const institutes = result.rows.map((r) => ({
      ...r,
      revenue: num(r.revenue),
      isActive: r.status === 1,
      subscriptionStatus: r.subscriptionStatus || null,
      daysLeft: daysLeftOf(r.subscriptionStatus, r.accessEndsAt),
    }));
    return ok("Institutes report fetched.", { currency: currency(), institutes, pagination: result.pagination });
  } catch (e) {
    return fail("institutes", e);
  }
};

// ─── Activity: what each institute did in a period ────────────────────────────

const ACTIVITY_SORTS = {
  name: `name`,
  exams: `exams`,
  sheets: `sheets`,
  evaluations: `evaluations`,
  failedEvaluations: `"failedEvaluations"`,
  students: `students`,
  teachers: `teachers`,
  total: `(exams + sheets + evaluations + students + teachers)`,
} as const;
type ActivitySort = keyof typeof ACTIVITY_SORTS;

const ACTIVITY_SQL = (orderBy: string) => `
WITH win AS (
  SELECT (to_date(:from, 'YYYY-MM')::timestamp AT TIME ZONE :tz) AS t0,
         ((to_date(:to, 'YYYY-MM') + interval '1 month')::timestamp AT TIME ZONE :tz) AS t1
),
live AS (
  SELECT i.id, i."instituteId", i."instituteName" AS name, i.slug, i.city, i."logoUrl"
  FROM viaexam_institutes i
  WHERE i."isDeleted" = false AND (:search = '' OR i."instituteName" ILIKE :like OR i.slug ILIKE :like OR i.city ILIKE :like)
),
ex AS (SELECT x."instituteId", COUNT(*)::int AS n FROM viaexam_exams x, win
       WHERE x."isDeleted" = false AND x."createdAt" >= win.t0 AND x."createdAt" < win.t1 GROUP BY 1),
sh AS (SELECT x."instituteId", COUNT(*)::int AS n FROM viaexam_answer_sheets x, win
       WHERE x."isDeleted" = false AND x."createdAt" >= win.t0 AND x."createdAt" < win.t1 GROUP BY 1),
ev AS (SELECT x."instituteId", COUNT(*)::int AS n, COUNT(*) FILTER (WHERE e.status = 'Failed')::int AS failed
       FROM viaexam_ai_evaluations e JOIN viaexam_answer_sheets x ON x."sheetId" = e."sheetId", win
       WHERE e."createdAt" >= win.t0 AND e."createdAt" < win.t1 GROUP BY 1),
st AS (SELECT x."instituteId", COUNT(*)::int AS n FROM viaexam_student_profiles x, win
       WHERE x."createdAt" >= win.t0 AND x."createdAt" < win.t1 GROUP BY 1),
te AS (SELECT x."instituteId", COUNT(*)::int AS n FROM viaexam_teacher_profiles x, win
       WHERE x."createdAt" >= win.t0 AND x."createdAt" < win.t1 GROUP BY 1),
rows AS (
  SELECT live.*, COALESCE(ex.n, 0) AS exams, COALESCE(sh.n, 0) AS sheets, COALESCE(ev.n, 0) AS evaluations,
         COALESCE(ev.failed, 0) AS "failedEvaluations", COALESCE(st.n, 0) AS students, COALESCE(te.n, 0) AS teachers
  FROM live
  LEFT JOIN ex ON ex."instituteId" = live."instituteId"
  LEFT JOIN sh ON sh."instituteId" = live."instituteId"
  LEFT JOIN ev ON ev."instituteId" = live."instituteId"
  LEFT JOIN st ON st."instituteId" = live."instituteId"
  LEFT JOIN te ON te."instituteId" = live."instituteId"
),
shown AS (
  SELECT * FROM rows
  WHERE NOT :activeOnly OR (exams + sheets + evaluations + students + teachers) > 0
)
SELECT shown.*, COUNT(*) OVER()::int AS total_count,
       SUM(exams) OVER()::int AS sum_exams, SUM(sheets) OVER()::int AS sum_sheets,
       SUM(evaluations) OVER()::int AS sum_evaluations, SUM("failedEvaluations") OVER()::int AS sum_failed,
       SUM(students) OVER()::int AS sum_students, SUM(teachers) OVER()::int AS sum_teachers
FROM shown
ORDER BY ${orderBy}
LIMIT :limit OFFSET :offset`;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Current month in IST as YYYY-MM, shifted by `delta` months. */
const monthKey = (delta = 0) => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: TZ }));
  const d = new Date(now.getFullYear(), now.getMonth() + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const listActivity = async (query: Query) => {
  const { page, limit } = paging(query);
  const search = str(query.search);
  let from = MONTH_RE.test(str(query.from, 7)) ? str(query.from, 7) : monthKey(-11);
  let to = MONTH_RE.test(str(query.to, 7)) ? str(query.to, 7) : monthKey(0);
  if (from > to) [from, to] = [to, from];
  const activeOnly = query.activeOnly !== "false";
  const sort = pick(query.sort, Object.keys(ACTIVITY_SORTS) as ActivitySort[], "total");
  const order = pick(query.order, ["asc", "desc"] as const, sort === "name" ? "asc" : "desc");
  const orderBy = `${ACTIVITY_SORTS[sort]} ${order.toUpperCase()}, name ASC`;

  try {
    const key = `sa-rep:activity:${JSON.stringify([page, limit, search, from, to, activeOnly, sort, order])}`;
    const result = await memoize(key, CACHE_MS, async () => {
      const replacements = { search, like: like(search), from, to, tz: TZ, activeOnly };
      const run = (offset: number) =>
        sequelize.query<Row>(ACTIVITY_SQL(orderBy), {
          type: QueryTypes.SELECT,
          replacements: { ...replacements, limit, offset },
        });
      let rows = await run((page - 1) * limit);
      let current = page;
      if (rows.length === 0 && page > 1) {
        rows = await run(0);
        current = 1;
      }
      const first = rows[0] || {};
      const totals = {
        exams: num(first.sum_exams),
        sheets: num(first.sum_sheets),
        evaluations: num(first.sum_evaluations),
        failedEvaluations: num(first.sum_failed),
        students: num(first.sum_students),
        teachers: num(first.sum_teachers),
      };
      const institutes = rows.map(
        ({ total_count, sum_exams, sum_sheets, sum_evaluations, sum_failed, sum_students, sum_teachers, ...r }) => r
      );
      return { from, to, totals, institutes, pagination: pagination(num(first.total_count), current, limit) };
    });
    return ok("Activity report fetched.", result);
  } catch (e) {
    return fail("activity", e);
  }
};

// ─── Revenue: months × kind, plans, top institutes ────────────────────────────

const REVENUE_MONTHS_SQL = `
WITH months AS (
  SELECT generate_series(
    date_trunc('month', now() AT TIME ZONE :tz) - ((:span - 1) * interval '1 month'),
    date_trunc('month', now() AT TIME ZONE :tz),
    interval '1 month'
  ) AS m
),
start AS (SELECT (MIN(m) AT TIME ZONE :tz) AS t FROM months),
tx AS (
  SELECT x.amount, x.kind, x.status, x."instituteId",
         date_trunc('month', COALESCE(x."paidAt", x."createdAt") AT TIME ZONE :tz) AS m
  FROM viaexam_subscription_transactions x, start
  WHERE x.kind <> 'trial' AND x.currency = :currency AND COALESCE(x."paidAt", x."createdAt") >= start.t
)
SELECT to_char(months.m, 'YYYY-MM') AS month,
       COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'paid'), 0)::float8 AS total,
       COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'paid' AND tx.kind = 'purchase'), 0)::float8 AS purchase,
       COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'paid' AND tx.kind = 'renewal'), 0)::float8 AS renewal,
       COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'paid' AND tx.kind IN ('upgrade', 'downgrade')), 0)::float8 AS "planChange",
       COALESCE(SUM(tx.amount) FILTER (WHERE tx.status = 'paid' AND tx.kind = 'manual'), 0)::float8 AS manual,
       COUNT(tx.*) FILTER (WHERE tx.status = 'paid' AND tx.amount > 0)::int AS payments,
       COUNT(tx.*) FILTER (WHERE tx.status = 'failed')::int AS failed,
       COUNT(DISTINCT tx."instituteId") FILTER (WHERE tx.status = 'paid' AND tx.amount > 0)::int AS payers
FROM months LEFT JOIN tx ON tx.m = months.m
GROUP BY months.m
ORDER BY months.m`;

const REVENUE_BREAKDOWN_SQL = `
WITH start AS (
  SELECT ((date_trunc('month', now() AT TIME ZONE :tz) - ((:span - 1) * interval '1 month')) AT TIME ZONE :tz) AS t
),
paid AS (
  SELECT x.* FROM viaexam_subscription_transactions x, start
  WHERE x.status = 'paid' AND x.kind <> 'trial' AND x.currency = :currency AND x.amount > 0 AND x."paidAt" >= start.t
)
SELECT
  (SELECT COALESCE(json_agg(y ORDER BY y.amount DESC), '[]'::json) FROM (
     SELECT paid."planKey", COALESCE(p.name, paid."planKey") AS name, SUM(paid.amount)::float8 AS amount, COUNT(*)::int AS payments
     FROM paid LEFT JOIN viaexam_plans p ON p."planKey" = paid."planKey"
     GROUP BY 1, 2
   ) y) AS "byPlan",
  (SELECT COALESCE(json_agg(z ORDER BY z.amount DESC), '[]'::json) FROM (
     SELECT i.id, i."instituteId", i."instituteName" AS name, i.slug, i."logoUrl",
            SUM(paid.amount)::float8 AS amount, COUNT(*)::int AS payments, MAX(paid."paidAt") AS "lastPaidAt"
     FROM paid JOIN viaexam_institutes i ON i."instituteId" = paid."instituteId"
     GROUP BY i.id, i."instituteId", i."instituteName", i.slug, i."logoUrl"
     ORDER BY 6 DESC
     LIMIT 10
   ) z) AS "topInstitutes",
  (SELECT COALESCE(json_agg(w ORDER BY w.amount DESC), '[]'::json) FROM (
     SELECT provider, SUM(amount)::float8 AS amount, COUNT(*)::int AS payments FROM paid GROUP BY 1
   ) w) AS "byProvider"`;

const getRevenue = async (query: Query) => {
  const span = Math.min(24, Math.max(1, Math.floor(num(query.months)) || 12));
  try {
    const data = await memoize(`sa-rep:revenue:${span}`, CACHE_MS, async () => {
      const replacements = { tz: TZ, span, currency: currency() };
      const [months, [breakdown]] = await Promise.all([
        sequelize.query<Row>(REVENUE_MONTHS_SQL, { type: QueryTypes.SELECT, replacements }),
        sequelize.query<Row>(REVENUE_BREAKDOWN_SQL, { type: QueryTypes.SELECT, replacements }),
      ]);
      const totals = months.reduce(
        (t, m) => ({
          collected: t.collected + num(m.total),
          payments: t.payments + num(m.payments),
          failed: t.failed + num(m.failed),
        }),
        { collected: 0, payments: 0, failed: 0 }
      );
      return {
        currency: currency(),
        months: span,
        series: months,
        totals: { ...totals, averagePayment: totals.payments ? Math.round(totals.collected / totals.payments) : 0 },
        byPlan: breakdown?.byPlan || [],
        byProvider: breakdown?.byProvider || [],
        topInstitutes: breakdown?.topInstitutes || [],
      };
    });
    return ok("Revenue report fetched.", data);
  } catch (e) {
    return fail("revenue", e);
  }
};

// ─── AI evaluations: every run, why it failed, who it was for ─────────────────

const EVALUATION_FROM = `
FROM viaexam_ai_evaluations e
LEFT JOIN viaexam_answer_sheets sh ON sh."sheetId" = e."sheetId"
LEFT JOIN viaexam_institutes i ON i."instituteId" = sh."instituteId"
LEFT JOIN viaexam_classes c ON c."classId" = e."classId"
LEFT JOIN viaexam_sections sec ON sec."sectionId" = e.section
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = e."subjectId"
LEFT JOIN viaexam_users u ON u."userId" = e."studentId"
WHERE i."isDeleted" IS DISTINCT FROM true
  AND e."updatedAt" >= :since
  AND (:instituteId = '' OR sh."instituteId" = :instituteId)
  AND (:search = '' OR sh."rollNo" ILIKE :like OR sh."studentName" ILIKE :like OR u."userName" ILIKE :like
       OR i."instituteName" ILIKE :like OR sub."subjectName" ILIKE :like OR e."examType" ILIKE :like)`;

const EVALUATIONS_SQL = `
SELECT e."evaluationId", e."sheetId", e.status, e.error, e."totalScore", e."examType", e."createdAt", e."updatedAt",
       sh."rollNo", COALESCE(NULLIF(sh."studentName", ''), u."userName") AS "studentName", sh."fileUrl",
       i.id AS "instituteRowId", i."instituteId", i."instituteName", i.slug AS "instituteSlug",
       COALESCE(c."className", e."classId") AS "className", COALESCE(sec."sectionName", e.section) AS "sectionName",
       COALESCE(sub."subjectName", e."subjectId") AS "subjectName",
       COUNT(*) OVER()::int AS total_count
${EVALUATION_FROM}
  AND (:status = '' OR e.status = :status)
ORDER BY e."updatedAt" DESC, e.id DESC
LIMIT :limit OFFSET :offset`;

const EVALUATION_SUMMARY_SQL = `
WITH base AS (SELECT e.status, e.error, e."updatedAt", sh."instituteId", i."instituteName", i.slug ${EVALUATION_FROM})
SELECT
  (SELECT COUNT(*)::int FROM base) AS total,
  (SELECT COUNT(*)::int FROM base WHERE status = 'Success') AS success,
  (SELECT COUNT(*)::int FROM base WHERE status = 'Failed') AS failed,
  (SELECT COUNT(*)::int FROM base WHERE status = 'Pending') AS pending,
  (SELECT COUNT(*)::int FROM base WHERE status = 'Failed' AND "updatedAt" >= now() - interval '24 hours') AS failed_24h,
  (SELECT COUNT(*)::int FROM base WHERE status = 'Pending' AND "updatedAt" < now() - interval '30 minutes') AS stuck,
  (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
     SELECT left(regexp_replace(COALESCE(error, ''), '\\s+', ' ', 'g'), 500) AS error, COUNT(*)::int AS n
     FROM base WHERE status = 'Failed' GROUP BY 1 ORDER BY 2 DESC LIMIT 200
   ) x) AS errors,
  (SELECT COALESCE(json_agg(y), '[]'::json) FROM (
     SELECT "instituteId", "instituteName" AS name, slug, COUNT(*)::int AS failed
     FROM base WHERE status = 'Failed' AND "instituteId" IS NOT NULL
     GROUP BY 1, 2, 3 ORDER BY 4 DESC, 2 LIMIT 6
   ) y) AS "byInstitute"`;

const listEvaluations = async (query: Query) => {
  const { page, limit } = paging(query);
  const status = pick(query.status, ["", "Failed", "Success", "Pending"] as const, "");
  const range = pick(query.range, RANGE_KEYS, "30d");
  const search = str(query.search);
  const instituteId = str(query.instituteId, 64);

  try {
    const filters = { since: sinceOf(range), instituteId, search, like: like(search) };
    const key = `sa-rep:evals:${JSON.stringify([page, limit, status, range, search, instituteId])}`;
    const data = await memoize(key, CACHE_MS, async () => {
      const [list, [summary]] = await Promise.all([
        pagedQuery(EVALUATIONS_SQL, { ...filters, status }, page, limit),
        sequelize.query<Row>(EVALUATION_SUMMARY_SQL, { type: QueryTypes.SELECT, replacements: filters }),
      ]);

      // Group the distinct error texts into actionable reasons.
      const reasons = new Map<string, { key: string; label: string; hint: string; count: number; sample: string }>();
      for (const { error, n } of (summary?.errors as { error: string; n: number }[]) || []) {
        const r = reasonOf(error);
        const entry = reasons.get(r.key) ?? { key: r.key, label: r.label, hint: r.hint, count: 0, sample: error };
        entry.count += num(n);
        reasons.set(r.key, entry);
      }

      return {
        range,
        summary: {
          total: num(summary?.total),
          success: num(summary?.success),
          failed: num(summary?.failed),
          pending: num(summary?.pending),
          failedLast24h: num(summary?.failed_24h),
          stuckPending: num(summary?.stuck),
          reasons: [...reasons.values()].sort((a, b) => b.count - a.count),
          byInstitute: summary?.byInstitute || [],
        },
        evaluations: list.rows.map(withReason),
        pagination: list.pagination,
      };
    });
    return ok("AI evaluations fetched.", data);
  } catch (e) {
    return fail("evaluations", e);
  }
};

// ─── Answer sheets: every upload and how far it got ───────────────────────────

const SHEET_FROM = `
FROM viaexam_answer_sheets sh
JOIN viaexam_institutes i ON i."instituteId" = sh."instituteId" AND i."isDeleted" = false
LEFT JOIN viaexam_ai_evaluations e ON e."sheetId" = sh."sheetId"
LEFT JOIN viaexam_classes c ON c."classId" = sh."classId"
LEFT JOIN viaexam_sections sec ON sec."sectionId" = sh.section
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = sh."subjectId"
WHERE sh."isDeleted" = false
  AND sh."createdAt" >= :since
  AND (:instituteId = '' OR sh."instituteId" = :instituteId)
  AND (:search = '' OR sh."rollNo" ILIKE :like OR sh."studentName" ILIKE :like OR i."instituteName" ILIKE :like
       OR sub."subjectName" ILIKE :like OR sh."examType" ILIKE :like OR sh."fileName" ILIKE :like)`;

// Sheet "stage": evaluated, evaluation failed, being evaluated, waiting for evaluation.
const SHEET_STAGE = `
  CASE
    WHEN sh.status IN ${EVALUATED_SHEET} OR e.status = 'Success' THEN 'evaluated'
    WHEN e.status = 'Failed' THEN 'failed'
    WHEN e.status = 'Pending' THEN 'evaluating'
    ELSE 'waiting'
  END`;

const SHEETS_SQL = `
SELECT sh."sheetId", sh."rollNo", sh."studentName", sh."fileName", sh."fileUrl", sh."fileMimeType", sh."fileSize"::float8 AS "fileSize",
       sh.status, sh."examType", sh."createdAt", sh."updatedAt",
       e."evaluationId", e.status AS "evaluationStatus", e."totalScore", e.error, e."updatedAt" AS "evaluatedAt",
       ${SHEET_STAGE} AS stage,
       i.id AS "instituteRowId", i."instituteId", i."instituteName", i.slug AS "instituteSlug",
       COALESCE(c."className", sh."classId") AS "className", COALESCE(sec."sectionName", sh.section) AS "sectionName",
       COALESCE(sub."subjectName", sh."subjectId") AS "subjectName",
       up."userName" AS "uploadedByName",
       COUNT(*) OVER()::int AS total_count
${SHEET_FROM.replace("WHERE sh.", `LEFT JOIN viaexam_users up ON up."userId" = sh."uploadedBy"\nWHERE sh.`)}
  AND (:stage = '' OR ${SHEET_STAGE} = :stage)
ORDER BY sh."createdAt" DESC, sh.id DESC
LIMIT :limit OFFSET :offset`;

const SHEET_SUMMARY_SQL = `
WITH base AS (
  SELECT ${SHEET_STAGE} AS stage, sh."createdAt", sh."instituteId", i."instituteName", i.slug ${SHEET_FROM}
)
SELECT
  (SELECT COUNT(*)::int FROM base) AS total,
  (SELECT COUNT(*)::int FROM base WHERE stage = 'evaluated') AS evaluated,
  (SELECT COUNT(*)::int FROM base WHERE stage = 'failed') AS failed,
  (SELECT COUNT(*)::int FROM base WHERE stage = 'evaluating') AS evaluating,
  (SELECT COUNT(*)::int FROM base WHERE stage = 'waiting') AS waiting,
  (SELECT COUNT(*)::int FROM base WHERE "createdAt" >= now() - interval '7 days') AS last_7d,
  (SELECT COALESCE(json_agg(y), '[]'::json) FROM (
     SELECT "instituteId", "instituteName" AS name, slug, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE stage = 'evaluated')::int AS evaluated
     FROM base GROUP BY 1, 2, 3 ORDER BY 4 DESC, 2 LIMIT 6
   ) y) AS "byInstitute"`;

const listAnswerSheets = async (query: Query) => {
  const { page, limit } = paging(query);
  const stage = pick(query.stage, ["", "evaluated", "failed", "evaluating", "waiting"] as const, "");
  const range = pick(query.range, RANGE_KEYS, "all");
  const search = str(query.search);
  const instituteId = str(query.instituteId, 64);

  try {
    const filters = { since: sinceOf(range), instituteId, search, like: like(search) };
    const key = `sa-rep:sheets:${JSON.stringify([page, limit, stage, range, search, instituteId])}`;
    const data = await memoize(key, CACHE_MS, async () => {
      const [list, [summary]] = await Promise.all([
        pagedQuery(SHEETS_SQL, { ...filters, stage }, page, limit),
        sequelize.query<Row>(SHEET_SUMMARY_SQL, { type: QueryTypes.SELECT, replacements: filters }),
      ]);
      return {
        range,
        summary: {
          total: num(summary?.total),
          evaluated: num(summary?.evaluated),
          failed: num(summary?.failed),
          evaluating: num(summary?.evaluating),
          waiting: num(summary?.waiting),
          uploadedLast7d: num(summary?.last_7d),
          byInstitute: summary?.byInstitute || [],
        },
        sheets: list.rows.map(withReason),
        pagination: list.pagination,
      };
    });
    return ok("Answer sheets fetched.", data);
  } catch (e) {
    return fail("answer-sheets", e);
  }
};

// ─── Exams: every exam with its progress ──────────────────────────────────────

const EXAM_STATUSES = ["Draft", "Paper Created", "Pending Approval", "Approved", "Rejected", "Live", "Completed"] as const;

const EXAM_FROM = `
FROM viaexam_exams x
JOIN viaexam_institutes i ON i."instituteId" = x."instituteId" AND i."isDeleted" = false
LEFT JOIN viaexam_classes c ON c."classId" = x."classId"
LEFT JOIN viaexam_sections sec ON sec."sectionId" = x."sectionId"
LEFT JOIN viaexam_subjects sub ON sub."subjectId" = x."subjectId"
LEFT JOIN viaexam_users t ON t."userId" = x."teacherId"
WHERE x."isDeleted" = false
  AND (:instituteId = '' OR x."instituteId" = :instituteId)
  AND (:when = '' OR (:when = 'upcoming' AND x."examDate" >= (now() AT TIME ZONE :tz)::date)
                  OR (:when = 'past' AND x."examDate" < (now() AT TIME ZONE :tz)::date)
                  OR (:when = 'unscheduled' AND x."examDate" IS NULL))
  AND (:search = '' OR x."examType" ILIKE :like OR sub."subjectName" ILIKE :like OR c."className" ILIKE :like
       OR i."instituteName" ILIKE :like OR t."userName" ILIKE :like)`;

const EXAMS_SQL = `
WITH sheets AS (
  SELECT "instituteId", "classId", "subjectId", "examType", COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE status IN ${EVALUATED_SHEET})::int AS evaluated
  FROM viaexam_answer_sheets WHERE "isDeleted" = false GROUP BY 1, 2, 3, 4
)
SELECT x."examId", x."examType", x."sessionId", x.status, to_char(x."examDate", 'YYYY-MM-DD') AS "examDate",
       x."examTime"::text AS "examTime", x.duration,
       x."totalMarks", x."passingMarks", x."createdAt", x."updatedAt",
       i.id AS "instituteRowId", i."instituteId", i."instituteName", i.slug AS "instituteSlug",
       COALESCE(c."className", x."classId") AS "className", sec."sectionName",
       COALESCE(sub."subjectName", x."subjectId") AS "subjectName", t."userName" AS "teacherName",
       COALESCE(s.n, 0) AS sheets, COALESCE(s.evaluated, 0) AS "evaluatedSheets",
       COUNT(*) OVER()::int AS total_count
${EXAM_FROM.replace("WHERE x.", `LEFT JOIN sheets s ON s."instituteId" = x."instituteId" AND s."classId" = x."classId"
  AND s."subjectId" = x."subjectId" AND s."examType" = x."examType"\nWHERE x.`)}
  AND (:status = '' OR x.status = :status)
ORDER BY ORDER_BY
LIMIT :limit OFFSET :offset`;

const EXAM_SORTS = {
  createdAt: `x."createdAt" DESC`,
  examDate: `x."examDate" DESC NULLS LAST, x."createdAt" DESC`,
  upcoming: `x."examDate" ASC NULLS LAST, x."createdAt" DESC`,
} as const;

const EXAM_SUMMARY_SQL = `
WITH base AS (SELECT x.status, x."examDate", x."createdAt" ${EXAM_FROM})
SELECT
  (SELECT COUNT(*)::int FROM base) AS total,
  (SELECT COALESCE(json_object_agg(status, n), '{}'::json) FROM (SELECT status, COUNT(*)::int AS n FROM base GROUP BY 1) s) AS "byStatus",
  (SELECT COUNT(*)::int FROM base WHERE "examDate" >= (now() AT TIME ZONE :tz)::date) AS upcoming,
  (SELECT COUNT(*)::int FROM base WHERE "examDate" = (now() AT TIME ZONE :tz)::date) AS today,
  (SELECT COUNT(*)::int FROM base WHERE "examDate" IS NULL) AS unscheduled,
  (SELECT COUNT(*)::int FROM base WHERE "createdAt" >= (date_trunc('month', now() AT TIME ZONE :tz) AT TIME ZONE :tz)) AS this_month`;

const listExams = async (query: Query) => {
  const { page, limit } = paging(query);
  const status = pick(query.status, ["", ...EXAM_STATUSES] as const, "");
  const when = pick(query.when, ["", "upcoming", "past", "unscheduled"] as const, "");
  const sort = pick(query.sort, Object.keys(EXAM_SORTS) as (keyof typeof EXAM_SORTS)[], when === "upcoming" ? "upcoming" : "createdAt");
  const search = str(query.search);
  const instituteId = str(query.instituteId, 64);

  try {
    const filters = { instituteId, when, tz: TZ, search, like: like(search) };
    const key = `sa-rep:exams:${JSON.stringify([page, limit, status, when, sort, search, instituteId])}`;
    const data = await memoize(key, CACHE_MS, async () => {
      const [list, [summary]] = await Promise.all([
        pagedQuery(EXAMS_SQL.replace("ORDER_BY", EXAM_SORTS[sort]), { ...filters, status }, page, limit),
        sequelize.query<Row>(EXAM_SUMMARY_SQL, { type: QueryTypes.SELECT, replacements: filters }),
      ]);
      return {
        summary: {
          total: num(summary?.total),
          byStatus: summary?.byStatus || {},
          upcoming: num(summary?.upcoming),
          today: num(summary?.today),
          unscheduled: num(summary?.unscheduled),
          createdThisMonth: num(summary?.this_month),
        },
        statuses: EXAM_STATUSES,
        exams: list.rows,
        pagination: list.pagination,
      };
    });
    return ok("Exams fetched.", data);
  } catch (e) {
    return fail("exams", e);
  }
};

// ─── Platform: read-only facts for the settings page (no secrets) ─────────────

const PLATFORM_SQL = `
SELECT
  (SELECT COALESCE(json_agg(a ORDER BY a."userName"), '[]'::json) FROM (
     SELECT u."userId", u."userName", u."emailId", u."lastLoginAt", u.status
     FROM viaexam_users u JOIN roles r ON r.id = u."roleId"
     WHERE upper(r.role) = 'SUPER_ADMIN' AND u."isDeleted" IS DISTINCT FROM true
   ) a) AS admins,
  (SELECT COUNT(*)::int FROM viaexam_plans WHERE "isActive" = true) AS active_plans,
  (SELECT COUNT(*)::int FROM viaexam_push_tokens) AS push_devices,
  (SELECT version()) AS db_version`;

const stripeMode = () => {
  const key = String(config.stripe.secretKey || "");
  if (!isStripeConfigured()) return "not_configured";
  return key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "test";
};

const getPlatform = async () => {
  try {
    const data = await memoize("sa-rep:platform", 60_000, async () => {
      const [row] = await sequelize.query<Row>(PLATFORM_SQL, { type: QueryTypes.SELECT });
      let pushConfigured = false;
      try {
        pushConfigured = Boolean(getFirebaseMessaging());
      } catch {
        pushConfigured = false;
      }
      return {
        environment: config.env,
        timezone: TZ,
        database: String(row?.db_version || "").split(",")[0] || null,
        billing: {
          provider: "Stripe Checkout",
          currency: currency().toUpperCase(),
          mode: stripeMode(),
          webhookConfigured: Boolean(config.stripe.webhookSecret),
          activePlans: num(row?.active_plans),
        },
        notifications: { pushConfigured, registeredDevices: num(row?.push_devices) },
        uploads: {
          maxFileMb: Math.round(ANSWER_SHEET_LIMITS.maxFileBytes / 1024 / 1024),
          maxFilesPerRequest: ANSWER_SHEET_LIMITS.maxFilesPerRequest,
          maxRequestMb: Math.round(ANSWER_SHEET_LIMITS.maxRequestBytes / 1024 / 1024),
        },
        rules: { onlineWindowMinutes: ONLINE_WINDOW_MINUTES, renewalWindowDays: RENEWAL_WINDOW_DAYS },
        superAdmins: row?.admins || [],
      };
    });
    return ok("Platform details fetched.", { ...data, serverTime: new Date().toISOString() });
  } catch (e) {
    return fail("platform", e);
  }
};

export default { listInstitutes, listActivity, getRevenue, listEvaluations, listAnswerSheets, listExams, getPlatform };
