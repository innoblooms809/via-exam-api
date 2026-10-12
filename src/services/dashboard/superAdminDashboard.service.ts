import httpStatus from "http-status";
import { QueryTypes } from "sequelize";
import { sequelize } from "../../config/sequelize";
import config from "../../config/config";
import logger from "../../config/logger";
import { memoize } from "../../utils/memoCache";

// Platform-wide numbers for the super admin dashboard. Every section is one SQL
// statement (one pooled connection, one round trip) built from aggregates — no rows
// are loaded into Node just to be counted. Results are cached briefly per process.

const TZ = "Asia/Kolkata";
const CACHE_MS = 60_000;
const LIVE_CACHE_MS = 20_000;
const ONLINE_WINDOW = "30 minutes"; // same rule as the monitoring page
const RENEWAL_WINDOW_DAYS = 7; // same window as "Ending in 7 days" on the subscriptions page

const currency = () => String(config.stripe.currency || "inr").toLowerCase();

// Status as of now: a lapsed trial/period counts as expired even before the hourly job persists it
// (mirrors effectiveStatus() in subscription.service).
const EFFECTIVE_STATUS = `
  CASE
    WHEN s.status = 'trialing' AND (s."trialEndsAt" IS NULL OR s."trialEndsAt" <= now()) THEN 'expired'
    WHEN s.status = 'active' AND (s."currentPeriodEnd" IS NULL OR s."currentPeriodEnd" <= now()) THEN 'expired'
    ELSE s.status
  END`;
const ACCESS_ENDS_AT = `CASE s.status WHEN 'trialing' THEN s."trialEndsAt" WHEN 'active' THEN s."currentPeriodEnd" END`;

const ok = (message: string, data: unknown) => ({ error: false, statusCode: httpStatus.OK, message, data });
const fail = (scope: string, e: any) => {
  logger.error(`[SuperAdminDashboard] ${scope}: ${e?.message || e}`);
  return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Could not load dashboard data." };
};

const num = (v: unknown) => Number(v) || 0;

// ─── Summary: KPIs, alerts, revenue, subscription mix ─────────────────────────

const SUMMARY_SQL = `
WITH b AS (
  SELECT (date_trunc('month', now() AT TIME ZONE :tz) AT TIME ZONE :tz) AS m0,
         ((date_trunc('month', now() AT TIME ZONE :tz) - interval '1 month') AT TIME ZONE :tz) AS m1
),
live AS (SELECT "instituteId", status, "createdAt" FROM viaexam_institutes WHERE "isDeleted" = false),
inst AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status = 1)::int AS active,
         COUNT(*) FILTER (WHERE live."createdAt" >= b.m0)::int AS this_month,
         COUNT(*) FILTER (WHERE live."createdAt" >= b.m1 AND live."createdAt" < b.m0)::int AS last_month
  FROM live, b
),
stu AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m0)::int AS this_month,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m1 AND x."createdAt" < b.m0)::int AS last_month
  FROM viaexam_student_profiles x, b
  WHERE x."instituteId" IN (SELECT "instituteId" FROM live)
),
tea AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m0)::int AS this_month,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m1 AND x."createdAt" < b.m0)::int AS last_month
  FROM viaexam_teacher_profiles x, b
  WHERE x."instituteId" IN (SELECT "instituteId" FROM live)
),
exm AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE x.status = 'Live')::int AS live,
         COUNT(*) FILTER (WHERE x.status = 'Completed')::int AS completed,
         COUNT(*) FILTER (WHERE x.status = 'Approved')::int AS approved,
         COUNT(*) FILTER (WHERE x.status = 'Pending Approval')::int AS pending_approval,
         COUNT(*) FILTER (WHERE x."examDate" >= (now() AT TIME ZONE :tz)::date)::int AS upcoming,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m0)::int AS this_month,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m1 AND x."createdAt" < b.m0)::int AS last_month
  FROM viaexam_exams x, b
  WHERE x."isDeleted" = false AND x."instituteId" IN (SELECT "instituteId" FROM live)
),
sht AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE x.status IN ('Evaluated', 'Processed'))::int AS evaluated,
         COUNT(*) FILTER (WHERE x.status = 'Pending')::int AS pending,
         COUNT(*) FILTER (WHERE x."createdAt" >= now() - interval '7 days')::int AS last_7d,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m0)::int AS this_month,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m1 AND x."createdAt" < b.m0)::int AS last_month
  FROM viaexam_answer_sheets x, b
  WHERE x."isDeleted" = false AND x."instituteId" IN (SELECT "instituteId" FROM live)
),
evl AS (
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE x.status = 'Success')::int AS success,
         COUNT(*) FILTER (WHERE x.status = 'Failed')::int AS failed,
         COUNT(*) FILTER (WHERE x.status = 'Failed' AND x."updatedAt" >= now() - interval '24 hours')::int AS failed_24h,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m0)::int AS this_month,
         COUNT(*) FILTER (WHERE x."createdAt" >= b.m1 AND x."createdAt" < b.m0)::int AS last_month
  FROM viaexam_ai_evaluations x, b
),
rev AS (
  SELECT COALESCE(SUM(x.amount) FILTER (WHERE x.status = 'paid' AND x.currency = :currency), 0)::float8 AS total,
         COALESCE(SUM(x.amount) FILTER (WHERE x.status = 'paid' AND x.currency = :currency AND x."paidAt" >= b.m0), 0)::float8 AS this_month,
         COALESCE(SUM(x.amount) FILTER (WHERE x.status = 'paid' AND x.currency = :currency AND x."paidAt" >= b.m1 AND x."paidAt" < b.m0), 0)::float8 AS last_month,
         COUNT(*) FILTER (WHERE x.status = 'failed' AND x.kind <> 'trial' AND x."createdAt" >= now() - interval '30 days')::int AS failed_30d
  FROM viaexam_subscription_transactions x, b
),
subs AS (
  SELECT s."planKey", s."billingCycle", ${EFFECTIVE_STATUS} AS eff, ${ACCESS_ENDS_AT} AS ends
  FROM viaexam_subscriptions s
  JOIN live l ON l."instituteId" = s."instituteId"
),
sub AS (
  SELECT COUNT(*) FILTER (WHERE eff = 'active')::int AS active,
         COUNT(*) FILTER (WHERE eff = 'trialing')::int AS trialing,
         COUNT(*) FILTER (WHERE eff = 'expired')::int AS expired,
         COUNT(*) FILTER (WHERE eff = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE eff IN ('active', 'trialing') AND ends <= now() + (:renewalDays * interval '1 day'))::int AS expiring_soon,
         COALESCE(SUM(
           CASE WHEN eff = 'active' AND p.currency = :currency
             THEN CASE WHEN subs."billingCycle" = 'yearly' THEN p."yearlyPrice" / 12.0 ELSE p."monthlyPrice" END
           END
         ), 0)::float8 AS mrr
  FROM subs LEFT JOIN viaexam_plans p ON p."planKey" = subs."planKey"
),
plan_mix AS (
  SELECT COALESCE(json_agg(json_build_object('planKey', x."planKey", 'name', x.name, 'count', x.n) ORDER BY x.sort, x.name), '[]'::json) AS rows
  FROM (
    SELECT subs."planKey", COALESCE(p.name, subs."planKey") AS name, COALESCE(p."sortOrder", 99) AS sort, COUNT(*)::int AS n
    FROM subs LEFT JOIN viaexam_plans p ON p."planKey" = subs."planKey"
    WHERE eff IN ('active', 'trialing')
    GROUP BY 1, 2, 3
  ) x
),
onl AS (
  SELECT COUNT(*)::int AS total FROM viaexam_user_presence_sessions
  WHERE "presenceStatus" = 'ONLINE' AND "lastActivityAt" >= now() - interval '${ONLINE_WINDOW}'
    AND upper(role) <> 'SUPER_ADMIN'
)
SELECT row_to_json(inst) AS inst, row_to_json(stu) AS stu, row_to_json(tea) AS tea, row_to_json(exm) AS exm,
       row_to_json(sht) AS sht, row_to_json(evl) AS evl, row_to_json(rev) AS rev, row_to_json(sub) AS sub,
       plan_mix.rows AS plan_mix, onl.total AS online
FROM inst, stu, tea, exm, sht, evl, rev, sub, plan_mix, onl`;

type Row = Record<string, any>;
const period = (r: Row) => ({ total: num(r.total), thisMonth: num(r.this_month), lastMonth: num(r.last_month) });

const loadSummary = async () => {
  const [row] = await sequelize.query<Row>(SUMMARY_SQL, {
    type: QueryTypes.SELECT,
    replacements: { tz: TZ, currency: currency(), renewalDays: RENEWAL_WINDOW_DAYS },
  });
  const { inst, stu, tea, exm, sht, evl, rev, sub } = row;
  return {
    generatedAt: new Date().toISOString(),
    currency: currency(),
    institutes: { ...period(inst), active: num(inst.active) },
    students: period(stu),
    teachers: period(tea),
    exams: {
      ...period(exm),
      live: num(exm.live),
      completed: num(exm.completed),
      approved: num(exm.approved),
      pendingApproval: num(exm.pending_approval),
      upcoming: num(exm.upcoming),
    },
    sheets: { ...period(sht), evaluated: num(sht.evaluated), pending: num(sht.pending), last7d: num(sht.last_7d) },
    evaluations: { ...period(evl), success: num(evl.success), failed: num(evl.failed) },
    revenue: {
      mrr: Math.round(num(sub.mrr)),
      total: num(rev.total),
      thisMonth: num(rev.this_month),
      lastMonth: num(rev.last_month),
    },
    subscriptions: {
      active: num(sub.active),
      trialing: num(sub.trialing),
      expired: num(sub.expired),
      cancelled: num(sub.cancelled),
      byPlan: (row.plan_mix as { planKey: string; name: string; count: number }[]) || [],
    },
    alerts: {
      expiringSoon: num(sub.expiring_soon),
      expired: num(sub.expired),
      failedPayments30d: num(rev.failed_30d),
      failedEvaluations24h: num(evl.failed_24h),
      pendingSheets: num(sht.pending),
    },
    onlineNow: num(row.online),
  };
};

const getSummary = async () => {
  try {
    return ok("Dashboard summary fetched.", await memoize("sa-dash:summary", CACHE_MS, loadSummary));
  } catch (e) {
    return fail("summary", e);
  }
};

// ─── Trends: one row per month ────────────────────────────────────────────────

const TRENDS_SQL = `
WITH months AS (
  SELECT generate_series(
    date_trunc('month', now() AT TIME ZONE :tz) - ((:span - 1) * interval '1 month'),
    date_trunc('month', now() AT TIME ZONE :tz),
    interval '1 month'
  ) AS m
),
start AS (SELECT (MIN(m) AT TIME ZONE :tz) AS t FROM months),
live AS (SELECT "instituteId", "createdAt" FROM viaexam_institutes WHERE "isDeleted" = false)
SELECT to_char(months.m, 'YYYY-MM') AS month,
       COALESCE(r.v, 0)::float8 AS revenue,
       COALESCE(i.v, 0)::int AS institutes,
       COALESCE(st.v, 0)::int AS students,
       COALESCE(e.v, 0)::int AS exams,
       COALESCE(sh.v, 0)::int AS sheets,
       COALESCE(ev.v, 0)::int AS evaluations
FROM months
LEFT JOIN (
  SELECT date_trunc('month', x."paidAt" AT TIME ZONE :tz) AS m, SUM(x.amount) AS v
  FROM viaexam_subscription_transactions x, start
  WHERE x.status = 'paid' AND x.currency = :currency AND x."paidAt" >= start.t
  GROUP BY 1
) r ON r.m = months.m
LEFT JOIN (
  SELECT date_trunc('month', x."createdAt" AT TIME ZONE :tz) AS m, COUNT(*) AS v
  FROM live x, start WHERE x."createdAt" >= start.t GROUP BY 1
) i ON i.m = months.m
LEFT JOIN (
  SELECT date_trunc('month', x."createdAt" AT TIME ZONE :tz) AS m, COUNT(*) AS v
  FROM viaexam_student_profiles x, start
  WHERE x."createdAt" >= start.t AND x."instituteId" IN (SELECT "instituteId" FROM live)
  GROUP BY 1
) st ON st.m = months.m
LEFT JOIN (
  SELECT date_trunc('month', x."createdAt" AT TIME ZONE :tz) AS m, COUNT(*) AS v
  FROM viaexam_exams x, start
  WHERE x."isDeleted" = false AND x."createdAt" >= start.t AND x."instituteId" IN (SELECT "instituteId" FROM live)
  GROUP BY 1
) e ON e.m = months.m
LEFT JOIN (
  SELECT date_trunc('month', x."createdAt" AT TIME ZONE :tz) AS m, COUNT(*) AS v
  FROM viaexam_answer_sheets x, start
  WHERE x."isDeleted" = false AND x."createdAt" >= start.t AND x."instituteId" IN (SELECT "instituteId" FROM live)
  GROUP BY 1
) sh ON sh.m = months.m
LEFT JOIN (
  SELECT date_trunc('month', x."createdAt" AT TIME ZONE :tz) AS m, COUNT(*) AS v
  FROM viaexam_ai_evaluations x, start WHERE x."createdAt" >= start.t GROUP BY 1
) ev ON ev.m = months.m
ORDER BY months.m`;

const getTrends = async (query: { months?: string | number }) => {
  const span = Math.min(24, Math.max(3, Number(query.months) || 12));
  try {
    const months = await memoize(`sa-dash:trends:${span}`, CACHE_MS, () =>
      sequelize.query<Row>(TRENDS_SQL, {
        type: QueryTypes.SELECT,
        replacements: { tz: TZ, span, currency: currency() },
      })
    );
    return ok("Dashboard trends fetched.", { currency: currency(), months });
  } catch (e) {
    return fail("trends", e);
  }
};

// ─── Institutes: one row each with usage + subscription ──────────────────────

const INSTITUTE_SORT: Record<string, string> = {
  recent: `i."createdAt" DESC`,
  students: `students DESC, i."createdAt" DESC`,
  exams: `exams DESC, i."createdAt" DESC`,
  sheets: `sheets DESC, i."createdAt" DESC`,
};

const institutesSql = (orderBy: string) => `
SELECT i.id, i."instituteId", i."instituteName" AS name, i.slug, i.city, i.state, i."logoUrl",
       i."contactPersonName", i.status, i."createdAt",
       st.n AS students, te.n AS teachers, ex.n AS exams, sh.n AS sheets,
       s."planKey", COALESCE(p.name, s."planKey", i.plan) AS "planName", s."billingCycle",
       ${EFFECTIVE_STATUS} AS "subscriptionStatus", ${ACCESS_ENDS_AT} AS "accessEndsAt"
FROM viaexam_institutes i
LEFT JOIN viaexam_subscriptions s ON s."instituteId" = i."instituteId"
LEFT JOIN viaexam_plans p ON p."planKey" = s."planKey"
LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM viaexam_student_profiles x WHERE x."instituteId" = i."instituteId") st ON true
LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM viaexam_teacher_profiles x WHERE x."instituteId" = i."instituteId") te ON true
LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM viaexam_exams x WHERE x."instituteId" = i."instituteId" AND x."isDeleted" = false) ex ON true
LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n FROM viaexam_answer_sheets x WHERE x."instituteId" = i."instituteId" AND x."isDeleted" = false) sh ON true
WHERE i."isDeleted" = false
ORDER BY ${orderBy}
LIMIT :limit`;

const getInstitutes = async (query: { sort?: string; limit?: string | number }) => {
  const sort = INSTITUTE_SORT[String(query.sort)] ? String(query.sort) : "recent";
  const limit = Math.min(25, Math.max(1, Number(query.limit) || 8));
  try {
    const rows = await memoize(`sa-dash:institutes:${sort}:${limit}`, CACHE_MS, () =>
      sequelize.query<Row>(institutesSql(INSTITUTE_SORT[sort]), { type: QueryTypes.SELECT, replacements: { limit } })
    );
    const now = Date.now();
    const institutes = rows.map((r) => {
      const ends = r.accessEndsAt ? new Date(r.accessEndsAt).getTime() : null;
      const live = r.subscriptionStatus === "active" || r.subscriptionStatus === "trialing";
      return {
        ...r,
        isActive: r.status === 1,
        subscriptionStatus: r.subscriptionStatus || null,
        daysLeft: live && ends ? Math.max(0, Math.ceil((ends - now) / 86_400_000)) : null,
      };
    });
    return ok("Institutes fetched.", { sort, institutes });
  } catch (e) {
    return fail("institutes", e);
  }
};

// ─── Renewals due soon ────────────────────────────────────────────────────────

const RENEWALS_SQL = `
SELECT i."instituteId", i."instituteName" AS name, i.slug, i."logoUrl",
       s.status, s."planKey", COALESCE(p.name, s."planKey") AS "planName", s."billingCycle",
       p.currency, CASE WHEN s."billingCycle" = 'yearly' THEN p."yearlyPrice" ELSE p."monthlyPrice" END AS "renewalAmount",
       ${ACCESS_ENDS_AT} AS "accessEndsAt"
FROM viaexam_subscriptions s
JOIN viaexam_institutes i ON i."instituteId" = s."instituteId" AND i."isDeleted" = false
LEFT JOIN viaexam_plans p ON p."planKey" = s."planKey"
WHERE (s.status = 'trialing' AND s."trialEndsAt" > now() AND s."trialEndsAt" <= now() + (:days * interval '1 day'))
   OR (s.status = 'active' AND s."currentPeriodEnd" > now() AND s."currentPeriodEnd" <= now() + (:days * interval '1 day'))
ORDER BY "accessEndsAt" ASC
LIMIT :limit`;

const getRenewals = async (query: { limit?: string | number }) => {
  const limit = Math.min(20, Math.max(1, Number(query.limit) || 6));
  try {
    const rows = await memoize(`sa-dash:renewals:${limit}`, CACHE_MS, () =>
      sequelize.query<Row>(RENEWALS_SQL, {
        type: QueryTypes.SELECT,
        replacements: { days: RENEWAL_WINDOW_DAYS, limit },
      })
    );
    const now = Date.now();
    const renewals = rows.map((r) => ({
      ...r,
      renewalAmount: r.renewalAmount === null ? null : num(r.renewalAmount),
      daysLeft: Math.max(0, Math.ceil((new Date(r.accessEndsAt).getTime() - now) / 86_400_000)),
    }));
    return ok("Upcoming renewals fetched.", { windowDays: RENEWAL_WINDOW_DAYS, renewals });
  } catch (e) {
    return fail("renewals", e);
  }
};

// ─── Who is online now ────────────────────────────────────────────────────────

const LIVE_SQL = `
WITH online AS (
  SELECT p."userId", p.role, p."instituteId", p."currentActivity", p."lastActivityAt"
  FROM viaexam_user_presence_sessions p
  WHERE p."presenceStatus" = 'ONLINE' AND p."lastActivityAt" >= now() - interval '${ONLINE_WINDOW}'
    AND upper(p.role) <> 'SUPER_ADMIN' -- the platform owner is not "usage"
)
SELECT
  (SELECT COUNT(*)::int FROM online) AS total,
  (SELECT COALESCE(json_object_agg(r.role, r.n), '{}'::json)
     FROM (SELECT upper(role) AS role, COUNT(*)::int AS n FROM online GROUP BY 1) r) AS "byRole",
  (SELECT COALESCE(json_agg(x), '[]'::json) FROM (
     SELECT i."instituteId", i."instituteName" AS name, i.slug, COUNT(*)::int AS online
     FROM online o JOIN viaexam_institutes i ON i."instituteId" = o."instituteId" AND i."isDeleted" = false
     GROUP BY 1, 2, 3 ORDER BY 4 DESC, 2 LIMIT 5
   ) x) AS "topInstitutes",
  (SELECT COALESCE(json_agg(y), '[]'::json) FROM (
     SELECT o."userId", u."userName", upper(o.role) AS role, o."currentActivity", o."lastActivityAt",
            i."instituteName"
     FROM online o
     JOIN viaexam_users u ON u."userId" = o."userId"
     LEFT JOIN viaexam_institutes i ON i."instituteId" = o."instituteId"
     ORDER BY o."lastActivityAt" DESC LIMIT 8
   ) y) AS recent`;

const getLive = async () => {
  try {
    const [row] = await memoize("sa-dash:live", LIVE_CACHE_MS, () =>
      sequelize.query<Row>(LIVE_SQL, { type: QueryTypes.SELECT })
    );
    return ok("Live users fetched.", {
      total: num(row.total),
      byRole: row.byRole || {},
      topInstitutes: row.topInstitutes || [],
      recent: row.recent || [],
    });
  } catch (e) {
    return fail("live", e);
  }
};

export default { getSummary, getTrends, getInstitutes, getRenewals, getLive };
