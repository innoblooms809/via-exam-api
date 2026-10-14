import httpStatus from "http-status";
import moment from "moment";
import { v4 as uuidv4 } from "uuid";
import { Op, Transaction, WhereOptions } from "sequelize";
import { sequelize } from "../../config/sequelize";
import config from "../../config/config";
import logger from "../../config/logger";
import { isStripeConfigured } from "../../config/stripe";
import Institute from "../../models/Institute.model";
import Plan from "../../models/Plan.model";
import Subscription, { BillingCycle, SubscriptionStatus } from "../../models/Subscription.model";
import SubscriptionTransaction, { TransactionKind } from "../../models/SubscriptionTransaction.model";
import StudentProfile from "../../models/Student.model";
import TeacherProfile from "../../models/TeacherProfile.model";
import PlanService, { minChargeFor } from "./plan.service";
import SubscriptionNotifier, { SUBSCRIPTION_NOTIFICATION, formatDate, formatMoney } from "./subscriptionNotifier";
import { invalidate } from "../../utils/memoCache";

const DAY_MS = 24 * 60 * 60 * 1000;
// Institutes that existed before billing was introduced get this long to choose a plan.
const LEGACY_GRACE_DAYS = 60;

// ─── Period helpers ───────────────────────────────────────────────────────────

export const addCycle = (start: Date, cycle: BillingCycle): Date =>
  moment(start).add(1, cycle === "yearly" ? "year" : "month").toDate();

const isAfter = (date: Date | null, now: Date) => Boolean(date && new Date(date).getTime() > now.getTime());

/** When the institute's current access (trial or paid) ends, or null if it has none. */
export const accessEndsAt = (sub: Subscription): Date | null => {
  if (sub.status === "trialing") return sub.trialEndsAt;
  if (sub.status === "active") return sub.currentPeriodEnd;
  return null;
};

/** Status as of now (the hourly job persists "expired", this covers the gap in between). */
export const effectiveStatus = (sub: Subscription, now = new Date()): SubscriptionStatus => {
  if (sub.status === "trialing" && !isAfter(sub.trialEndsAt, now)) return "expired";
  if (sub.status === "active" && !isAfter(sub.currentPeriodEnd, now)) return "expired";
  return sub.status;
};

const isPaidAndLive = (sub: Subscription, now: Date) => sub.status === "active" && isAfter(sub.currentPeriodEnd, now);

const priceFor = (plan: Plan, cycle: BillingCycle) => (cycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice);

/**
 * Where a newly bought period starts:
 *  - same plan + cycle while paid  → after the current period (renewal stacks)
 *  - same plan while on trial       → after the trial (free days are kept)
 *  - anything else                  → now (plan change takes effect immediately)
 */
export const resolvePeriodStart = (sub: Subscription, planKey: string, cycle: BillingCycle, now: Date): Date => {
  if (isPaidAndLive(sub, now) && sub.planKey === planKey && sub.billingCycle === cycle) {
    return new Date(sub.currentPeriodEnd as Date);
  }
  if (sub.status === "trialing" && isAfter(sub.trialEndsAt, now) && sub.planKey === planKey) {
    return new Date(sub.trialEndsAt as Date);
  }
  return now;
};

/** Unused value of the current paid period, credited when switching plan mid-period. */
const unusedCredit = (sub: Subscription, now: Date): number => {
  if (!isPaidAndLive(sub, now) || !sub.periodValue || !sub.currentPeriodStart) return 0;
  const start = new Date(sub.currentPeriodStart).getTime();
  const end = new Date(sub.currentPeriodEnd as Date).getTime();
  const total = end - start;
  if (total <= 0) return 0;
  const remaining = end - Math.max(now.getTime(), start);
  return Math.max(0, Math.round((sub.periodValue * remaining) / total));
};

const dailyRate = (plan: Plan, cycle: BillingCycle) => priceFor(plan, cycle) / (cycle === "yearly" ? 365 : 30);

export interface Quote {
  planKey: string;
  planName: string;
  billingCycle: BillingCycle;
  kind: TransactionKind;
  currency: string;
  originalAmount: number;
  creditApplied: number;
  creditCapped: boolean;
  amount: number;
  periodStart: Date;
  periodEnd: Date;
}

export const buildQuote = async (
  sub: Subscription,
  plan: Plan,
  cycle: BillingCycle,
  now = new Date()
): Promise<Quote> => {
  const originalAmount = priceFor(plan, cycle);
  const periodStart = resolvePeriodStart(sub, plan.planKey, cycle, now);
  const switching = periodStart.getTime() === now.getTime() && isPaidAndLive(sub, now);

  let kind: TransactionKind = "purchase";
  if (isPaidAndLive(sub, now)) {
    if (sub.planKey === plan.planKey && sub.billingCycle === cycle) {
      kind = "renewal";
    } else {
      const currentPlan = await PlanService.findPlan(sub.planKey);
      const currentRate = currentPlan ? dailyRate(currentPlan, (sub.billingCycle || "monthly") as BillingCycle) : 0;
      kind = dailyRate(plan, cycle) >= currentRate ? "upgrade" : "downgrade";
    }
  } else if (sub.status !== "trialing" && sub.billingCycle && sub.planKey === plan.planKey) {
    kind = "renewal"; // paid before, lapsed, paying again for the same plan
  }

  // Credit for unused time pays for the new plan. If what's left is below Stripe's minimum,
  // the credit covers it all and the switch needs no payment (any excess credit is not refunded).
  const fullCredit = switching ? unusedCredit(sub, now) : 0;
  let creditApplied = Math.min(fullCredit, originalAmount);
  if (fullCredit > 0 && originalAmount - creditApplied < minChargeFor(plan.currency)) {
    creditApplied = originalAmount;
  }
  const creditCapped = fullCredit > creditApplied;
  const amount = originalAmount - creditApplied;

  return {
    planKey: plan.planKey,
    planName: plan.name,
    billingCycle: cycle,
    kind,
    currency: plan.currency,
    originalAmount,
    creditApplied,
    creditCapped,
    amount,
    periodStart,
    periodEnd: addCycle(periodStart, cycle),
  };
};

/**
 * Applies a bought period to the subscription (inside the caller's DB transaction).
 * Used for Stripe payments and for free (₹0) plans.
 */
export const applyPaidPeriod = async (
  sub: Subscription,
  planKey: string,
  cycle: BillingCycle,
  originalAmount: number,
  t: Transaction,
  now = new Date()
): Promise<{ periodStart: Date; periodEnd: Date }> => {
  const periodStart = resolvePeriodStart(sub, planKey, cycle, now);
  const periodEnd = addCycle(periodStart, cycle);
  const extendsCurrent = isPaidAndLive(sub, now) && periodStart.getTime() > now.getTime();

  await sub.update(
    {
      planKey,
      billingCycle: cycle,
      status: "active",
      // A renewal extends the running period; a new or changed plan starts a fresh one
      // (after the trial when the trial plan itself is bought).
      currentPeriodStart: extendsCurrent ? sub.currentPeriodStart : periodStart,
      currentPeriodEnd: periodEnd,
      periodValue: extendsCurrent ? (sub.periodValue || 0) + originalAmount : originalAmount,
      // A plan switched during the trial ends the trial now.
      trialEndsAt: sub.status === "trialing" && sub.planKey !== planKey ? now : sub.trialEndsAt,
      cancelledAt: null,
      lastReminderKey: null,
    },
    { transaction: t }
  );
  await Institute.update({ plan: planKey, trialEndsAt: sub.trialEndsAt }, { where: { instituteId: sub.instituteId }, transaction: t });

  return { periodStart, periodEnd };
};

// ─── Creation / backfill ──────────────────────────────────────────────────────

/** Called when the super admin registers an institute (inside that transaction). */
const createForInstitute = async (
  instituteId: string,
  planKey: string,
  trialDays: number,
  t: Transaction,
  createdBy?: string
): Promise<Subscription> => {
  const plan = (await PlanService.findPlan(planKey)) || (await PlanService.findPlan("basic"));
  const key = plan?.planKey || planKey;
  const now = new Date();
  const trialEndsAt = trialDays > 0 ? new Date(now.getTime() + trialDays * DAY_MS) : null;

  const sub = await Subscription.create(
    {
      subscriptionId: uuidv4(),
      instituteId,
      planKey: key,
      status: trialEndsAt ? "trialing" : "expired",
      trialEndsAt,
    },
    { transaction: t }
  );

  if (trialEndsAt) {
    await SubscriptionTransaction.create(
      {
        transactionId: uuidv4(),
        instituteId,
        kind: "trial",
        planKey: key,
        currency: plan?.currency || config.stripe.currency,
        status: "paid",
        provider: "system",
        periodStart: now,
        periodEnd: trialEndsAt,
        paidAt: now,
        createdBy: createdBy || null,
        note: `${trialDays}-day free trial`,
      },
      { transaction: t }
    );
  }
  return sub;
};

/** Gives every institute without a subscription row one (institutes created before billing existed). */
const backfillSubscriptions = async (): Promise<void> => {
  try {
    const institutes = await Institute.findAll({
      attributes: ["instituteId", "plan", "trialEndsAt"],
      where: { isDeleted: false },
      include: [{ model: Subscription, as: "subscription", required: false, attributes: ["id"] }],
    });
    const missing = institutes.filter((i: any) => !i.subscription);
    if (missing.length === 0) return;

    const validKeys = new Set((await Plan.findAll({ attributes: ["planKey"] })).map((p) => p.planKey));
    const now = Date.now();
    for (const inst of missing) {
      const planKey = validKeys.has(String(inst.plan).toLowerCase()) ? String(inst.plan).toLowerCase() : "basic";
      const existingTrialEnd = inst.trialEndsAt ? new Date(inst.trialEndsAt).getTime() : 0;
      const trialEnd = new Date(Math.max(existingTrialEnd, now + LEGACY_GRACE_DAYS * DAY_MS));
      await Subscription.create({
        subscriptionId: uuidv4(),
        instituteId: inst.instituteId,
        planKey,
        status: "trialing",
        trialEndsAt: trialEnd,
      }).catch((e) => logger.error(`[Subscription] Backfill ${inst.instituteId}: ${e.message}`));
    }
    logger.info(`[Subscription] Created subscriptions for ${missing.length} existing institute(s)`);
  } catch (e: any) {
    logger.error(`[Subscription] Backfill failed: ${e.message}`);
  }
};

const getOrCreate = async (instituteId: string): Promise<Subscription | null> => {
  const existing = await Subscription.findOne({ where: { instituteId } });
  if (existing) return existing;
  const institute = await Institute.findOne({ where: { instituteId, isDeleted: false } });
  if (!institute) return null;
  await backfillSubscriptions();
  return Subscription.findOne({ where: { instituteId } });
};

// ─── Formatting ───────────────────────────────────────────────────────────────

const formatSubscription = (sub: Subscription, now = new Date()) => {
  const ends = accessEndsAt(sub);
  const status = effectiveStatus(sub, now);
  const live = status === "trialing" || status === "active";
  return {
    subscriptionId: sub.subscriptionId,
    instituteId: sub.instituteId,
    planKey: sub.planKey,
    billingCycle: sub.billingCycle,
    status,
    trialEndsAt: sub.trialEndsAt,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    accessEndsAt: ends,
    daysLeft: live && ends ? Math.max(0, Math.ceil((new Date(ends).getTime() - now.getTime()) / DAY_MS)) : 0,
    periodValue: sub.periodValue,
    cancelledAt: sub.cancelledAt,
    updatedAt: sub.updatedAt,
  };
};

const formatTransaction = (tx: SubscriptionTransaction & { institute?: Institute }) => ({
  transactionId: tx.transactionId,
  instituteId: tx.instituteId,
  instituteName: tx.institute?.instituteName,
  kind: tx.kind,
  planKey: tx.planKey,
  billingCycle: tx.billingCycle,
  originalAmount: tx.originalAmount,
  creditApplied: tx.creditApplied,
  amount: tx.amount,
  currency: tx.currency,
  status: tx.status,
  provider: tx.provider,
  receiptUrl: tx.receiptUrl,
  periodStart: tx.periodStart,
  periodEnd: tx.periodEnd,
  paidAt: tx.paidAt,
  note: tx.note,
  createdAt: tx.createdAt,
});

const getUsage = async (instituteId: string) => {
  const [students, teachers] = await Promise.all([
    StudentProfile.count({ where: { instituteId } }),
    TeacherProfile.count({ where: { instituteId } }),
  ]);
  return { students, teachers };
};

const notFound = (message = "Subscription not found.") => ({ error: true, statusCode: httpStatus.NOT_FOUND, message });
const serverError = (e: any) => ({
  error: true,
  statusCode: httpStatus.INTERNAL_SERVER_ERROR,
  message: `Something went wrong: ${e.message}`,
});

// ─── Expiry (shared by the hourly job and super-admin reads) ──────────────────

/** Marks lapsed trials/periods as expired. Each row is claimed atomically, so it is notified once. */
const expireDueSubscriptions = async (): Promise<number> => {
  const now = new Date();
  const due = await Subscription.findAll({
    where: {
      [Op.or]: [
        { status: "trialing", trialEndsAt: { [Op.lte]: now } },
        { status: "active", currentPeriodEnd: { [Op.lte]: now } },
      ],
    },
    include: [{ model: Institute, as: "institute", attributes: ["instituteName"] }],
  });

  let expired = 0;
  for (const sub of due) {
    const [count] = await Subscription.update(
      { status: "expired", lastReminderKey: null },
      { where: { id: sub.id, status: sub.status } }
    );
    if (count !== 1) continue;
    expired++;

    const name = (sub as any).institute?.instituteName || sub.instituteId;
    const what = sub.status === "trialing" ? "free trial" : "subscription";
    await SubscriptionNotifier.notifyInstituteAdmins(sub.instituteId, {
      type: SUBSCRIPTION_NOTIFICATION.EXPIRED,
      title: `Your ${what} has ended`,
      message: `Your ${what} ended on ${formatDate(accessEndsAt(sub))}. Choose a plan in Billing to keep using ViaExam without interruption.`,
    });
    await SubscriptionNotifier.notifySuperAdmins(sub.instituteId, {
      type: SUBSCRIPTION_NOTIFICATION.EXPIRED,
      title: `${name}: ${what} expired`,
      message: `${name}'s ${what} on the ${sub.planKey} plan expired on ${formatDate(accessEndsAt(sub))}.`,
    });
  }
  return expired;
};

// ─── ADMIN: my subscription ───────────────────────────────────────────────────

const getMySubscription = async (requestedBy: any): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    if (!instituteId) return notFound("Your account is not linked to an institute.");

    const sub = await getOrCreate(instituteId);
    if (!sub) return notFound();

    const [plan, plansResult, usage, transactions, institute] = await Promise.all([
      PlanService.findPlan(sub.planKey),
      PlanService.listPlans(false),
      getUsage(instituteId),
      SubscriptionTransaction.findAll({
        where: { instituteId, status: { [Op.ne]: "expired" } },
        order: [["createdAt", "DESC"]],
        limit: 50,
      }),
      Institute.findOne({ where: { instituteId }, attributes: ["instituteName", "slug", "contactEmail"] }),
    ]);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subscription fetched successfully.",
      data: {
        subscription: formatSubscription(sub),
        plan: plan ? PlanService.formatPlan(plan) : null,
        plans: plansResult.data?.plans || [],
        usage,
        transactions: transactions.map(formatTransaction),
        institute,
        paymentsEnabled: isStripeConfigured(),
      },
    };
  } catch (e: any) {
    return serverError(e);
  }
};

const getQuote = async (requestedBy: any, body: { planKey: string; billingCycle: BillingCycle }): Promise<any> => {
  try {
    const sub = await getOrCreate(requestedBy.instituteId);
    if (!sub) return notFound();
    const plan = await PlanService.findPlan(body.planKey);
    if (!plan || !plan.isActive) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "This plan is not available." };
    }
    const quote = await buildQuote(sub, plan, body.billingCycle);
    return { error: false, statusCode: httpStatus.OK, message: "Quote calculated.", data: { quote } };
  } catch (e: any) {
    return serverError(e);
  }
};

// ─── SUPER ADMIN ──────────────────────────────────────────────────────────────

const getOverview = async (): Promise<any> => {
  try {
    await expireDueSubscriptions();
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
    const monthStart = moment().startOf("month").toDate();

    const liveInstitute = { model: Institute, as: "institute", attributes: [], where: { isDeleted: false } };
    const [subs, plans, revenueMonth, revenueTotal, recent] = await Promise.all([
      Subscription.findAll({ include: [liveInstitute] }),
      Plan.findAll(),
      SubscriptionTransaction.sum("amount", { where: { status: "paid", paidAt: { [Op.gte]: monthStart } } }),
      SubscriptionTransaction.sum("amount", { where: { status: "paid" } }),
      SubscriptionTransaction.findAll({
        where: { status: { [Op.in]: ["paid", "failed"] }, kind: { [Op.ne]: "trial" } },
        include: [{ model: Institute, as: "institute", attributes: ["instituteName"] }],
        order: [["createdAt", "DESC"]],
        limit: 8,
      }),
    ]);

    const planByKey = new Map(plans.map((p) => [p.planKey, p]));
    const byStatus: Record<string, number> = { trialing: 0, active: 0, expired: 0, cancelled: 0 };
    const byPlan: Record<string, number> = {};
    let expiringSoon = 0;
    let mrr = 0;
    for (const sub of subs) {
      const status = effectiveStatus(sub, now);
      byStatus[status] = (byStatus[status] || 0) + 1;
      if (status === "trialing" || status === "active") {
        byPlan[sub.planKey] = (byPlan[sub.planKey] || 0) + 1;
        const ends = accessEndsAt(sub);
        if (ends && new Date(ends) <= weekAhead) expiringSoon++;
      }
      const plan = planByKey.get(sub.planKey);
      if (status === "active" && plan) {
        mrr += sub.billingCycle === "yearly" ? Math.round(plan.yearlyPrice / 12) : plan.monthlyPrice;
      }
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subscription overview fetched.",
      data: {
        totalInstitutes: subs.length,
        byStatus,
        byPlan,
        expiringSoon,
        mrr,
        revenueThisMonth: revenueMonth || 0,
        revenueTotal: revenueTotal || 0,
        currency: plans[0]?.currency || config.stripe.currency,
        recentTransactions: recent.map(formatTransaction),
      },
    };
  } catch (e: any) {
    return serverError(e);
  }
};

const listSubscriptions = async (query: any): Promise<any> => {
  try {
    await expireDueSubscriptions();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const now = new Date();

    const where: WhereOptions = {};
    if (query.planKey) Object.assign(where, { planKey: query.planKey });
    if (query.status) Object.assign(where, { status: query.status });
    if (query.expiringSoon === "true") {
      const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
      Object.assign(where, {
        [Op.or]: [
          { status: "trialing", trialEndsAt: { [Op.between]: [now, weekAhead] } },
          { status: "active", currentPeriodEnd: { [Op.between]: [now, weekAhead] } },
        ],
      });
    }

    const instituteWhere: WhereOptions = { isDeleted: false };
    if (query.search) {
      const term = `%${String(query.search).trim()}%`;
      Object.assign(instituteWhere, {
        [Op.or]: [
          { instituteName: { [Op.iLike]: term } },
          { slug: { [Op.iLike]: term } },
          { contactEmail: { [Op.iLike]: term } },
        ],
      });
    }

    const { rows, count } = await Subscription.findAndCountAll({
      where,
      include: [
        {
          model: Institute,
          as: "institute",
          where: instituteWhere,
          attributes: ["instituteId", "instituteName", "slug", "city", "state", "contactEmail", "logoUrl", "status"],
        },
        { model: Plan, as: "plan", attributes: ["name", "currency", "monthlyPrice", "yearlyPrice"] },
      ],
      order: [["updatedAt", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subscriptions fetched successfully.",
      data: {
        subscriptions: rows.map((sub: any) => ({
          ...formatSubscription(sub, now),
          planName: sub.plan?.name || sub.planKey,
          currency: sub.plan?.currency || config.stripe.currency,
          institute: sub.institute,
        })),
        pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
      },
    };
  } catch (e: any) {
    return serverError(e);
  }
};

const getInstituteSubscription = async (instituteId: string): Promise<any> => {
  try {
    const sub = await getOrCreate(instituteId);
    if (!sub) return notFound();
    const [institute, plan, usage, transactions] = await Promise.all([
      Institute.findOne({
        where: { instituteId },
        attributes: ["instituteId", "instituteName", "slug", "city", "state", "contactEmail", "contactPhone", "contactPersonName", "logoUrl", "status", "createdAt"],
      }),
      PlanService.findPlan(sub.planKey),
      getUsage(instituteId),
      SubscriptionTransaction.findAll({ where: { instituteId }, order: [["createdAt", "DESC"]], limit: 100 }),
    ]);

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Subscription fetched successfully.",
      data: {
        subscription: formatSubscription(sub),
        institute,
        plan: plan ? PlanService.formatPlan(plan) : null,
        usage,
        transactions: transactions.map(formatTransaction),
      },
    };
  } catch (e: any) {
    return serverError(e);
  }
};

/**
 * Super admin changes an institute's subscription by hand: switch plan, grant or
 * extend access, record an offline payment, cancel or reactivate. (This is the
 * subscription only; suspending the institute itself is institute.service.)
 */
const updateInstituteSubscription = async (instituteId: string, body: any, requestedBy: any): Promise<any> => {
  try {
    const sub = await getOrCreate(instituteId);
    if (!sub) return notFound();

    const planKey: string = body.planKey || sub.planKey;
    const plan = await PlanService.findPlan(planKey);
    if (!plan) return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Unknown plan." };

    const now = new Date();
    const cycle: BillingCycle = body.billingCycle || sub.billingCycle || "monthly";
    const status: SubscriptionStatus = body.status;
    const amountPaid: number = body.amountPaid || 0;
    const requestedEnd: Date | null = body.accessEndsAt ? new Date(body.accessEndsAt) : null;

    if ((status === "active" || status === "trialing") && requestedEnd && requestedEnd <= now) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "The access end date must be in the future." };
    }
    if (status === "trialing" && !requestedEnd) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "Set when the trial ends." };
    }

    const updates: Record<string, unknown> = { planKey, status, lastReminderKey: null };
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;

    if (status === "active") {
      const continuing = isPaidAndLive(sub, now) && sub.planKey === planKey && sub.billingCycle === cycle;
      periodStart = continuing ? new Date(sub.currentPeriodStart as Date) : now;
      periodEnd = requestedEnd || (continuing ? new Date(sub.currentPeriodEnd as Date) : addCycle(now, cycle));
      Object.assign(updates, {
        billingCycle: cycle,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        periodValue: continuing ? (sub.periodValue || 0) + amountPaid : amountPaid,
        cancelledAt: null,
      });
    } else if (status === "trialing") {
      periodStart = now;
      periodEnd = requestedEnd;
      Object.assign(updates, { trialEndsAt: requestedEnd, cancelledAt: null });
    } else if (status === "cancelled") {
      Object.assign(updates, { cancelledAt: now });
    }

    await sequelize.transaction(async (t) => {
      await sub.update(updates, { transaction: t });
      await Institute.update(
        { plan: planKey, ...(status === "trialing" ? { trialEndsAt: requestedEnd } : {}) },
        { where: { instituteId }, transaction: t }
      );
      await SubscriptionTransaction.create(
        {
          transactionId: uuidv4(),
          instituteId,
          kind: "manual",
          planKey,
          billingCycle: status === "active" ? cycle : null,
          originalAmount: amountPaid,
          amount: amountPaid,
          currency: plan.currency,
          status: "paid",
          provider: "manual",
          periodStart,
          periodEnd,
          paidAt: now,
          createdBy: requestedBy.userId,
          note: body.note || null,
        },
        { transaction: t }
      );
    });

    invalidate("sa-dash:");

    const statusText: Record<SubscriptionStatus, string> = {
      active: `active until ${formatDate(periodEnd)}`,
      trialing: `on a free trial until ${formatDate(periodEnd)}`,
      cancelled: "cancelled",
      expired: "marked as expired",
    };
    await SubscriptionNotifier.notifyInstituteAdmins(instituteId, {
      type: SUBSCRIPTION_NOTIFICATION.PLAN_CHANGED,
      title: "Your subscription was updated",
      message:
        `ViaExam updated your subscription: ${plan.name} plan, ${statusText[status]}.` +
        (amountPaid ? ` Payment of ${formatMoney(amountPaid, plan.currency)} recorded.` : "") +
        (body.note ? ` Note: ${body.note}` : ""),
    });

    return getInstituteSubscription(instituteId);
  } catch (e: any) {
    return serverError(e);
  }
};

const listTransactions = async (query: any): Promise<any> => {
  try {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const where: WhereOptions = { kind: { [Op.ne]: "trial" } };
    if (query.status) Object.assign(where, { status: query.status });
    if (query.provider) Object.assign(where, { provider: query.provider });
    if (query.instituteId) Object.assign(where, { instituteId: query.instituteId });
    if (query.kind) Object.assign(where, { kind: query.kind });
    // Date range on when the transaction was started ([from, to)).
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    const range: Record<symbol, Date> = {};
    if (from && !Number.isNaN(from.getTime())) range[Op.gte] = from;
    if (to && !Number.isNaN(to.getTime())) range[Op.lt] = to;
    if (Object.getOwnPropertySymbols(range).length) Object.assign(where, { createdAt: range });

    const instituteWhere: WhereOptions = {};
    if (query.search) {
      Object.assign(instituteWhere, { instituteName: { [Op.iLike]: `%${String(query.search).trim()}%` } });
    }

    const { rows, count } = await SubscriptionTransaction.findAndCountAll({
      where,
      include: [{ model: Institute, as: "institute", attributes: ["instituteName", "slug"], where: instituteWhere }],
      order: [["createdAt", "DESC"]],
      limit,
      offset: (page - 1) * limit,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Transactions fetched successfully.",
      data: {
        transactions: rows.map(formatTransaction),
        pagination: { total: count, page, limit, totalPages: Math.ceil(count / limit) },
      },
    };
  } catch (e: any) {
    return serverError(e);
  }
};

/** Keeps the subscription in step when the super admin edits an institute's plan from the institute form. */
const syncPlanFromInstitute = async (instituteId: string, planKey: string): Promise<void> => {
  try {
    const plan = await PlanService.findPlan(String(planKey).toLowerCase());
    if (!plan) return;
    await Subscription.update({ planKey: plan.planKey }, { where: { instituteId } });
  } catch (e: any) {
    logger.error(`[Subscription] Plan sync failed for ${instituteId}: ${e.message}`);
  }
};

export default {
  createForInstitute,
  backfillSubscriptions,
  getOrCreate,
  expireDueSubscriptions,
  getMySubscription,
  getQuote,
  getOverview,
  listSubscriptions,
  getInstituteSubscription,
  updateInstituteSubscription,
  listTransactions,
  syncPlanFromInstitute,
  formatSubscription,
  formatTransaction,
};
