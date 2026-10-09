import httpStatus from "http-status";
import { Op } from "sequelize";
import Plan from "../../models/Plan.model";
import Subscription from "../../models/Subscription.model";
import config from "../../config/config";
import logger from "../../config/logger";
import SubscriptionNotifier, { formatMoney } from "./subscriptionNotifier";

// Smallest amount Stripe accepts, in minor units. Stripe's floor is ~50 US cents in the
// account's settlement currency, so on a USD account an INR charge must be ≳ ₹45; ₹60 leaves room for FX moves.
const MIN_CHARGE: Record<string, number> = { inr: 6000, usd: 50, eur: 50, gbp: 30 };
export const minChargeFor = (currency: string): number => MIN_CHARGE[currency.toLowerCase()] ?? 100;

// Created on first start only; after that the super admin owns the values.
// Prices are in minor units (paise): 199900 = ₹1,999.
const DEFAULT_PLANS = [
  {
    planKey: "basic",
    name: "Basic",
    description: "For small schools getting started with digital exams.",
    monthlyPrice: 199900,
    yearlyPrice: 1999000,
    trialDays: 60,
    maxStudents: 500,
    maxTeachers: 25,
    features: [
      "Up to 500 students",
      "Up to 25 teachers",
      "Online exams & scheduling",
      "Answer sheet scanning",
      "Standard reports",
      "Email support",
    ],
    isPopular: false,
    sortOrder: 1,
  },
  {
    planKey: "pro",
    name: "Pro",
    description: "For growing institutes that need AI evaluation and analytics.",
    monthlyPrice: 499900,
    yearlyPrice: 4999000,
    trialDays: 0,
    maxStudents: 2000,
    maxTeachers: 100,
    features: [
      "Up to 2,000 students",
      "Up to 100 teachers",
      "AI answer sheet evaluation",
      "Advanced analytics",
      "Recheck workflow",
      "Priority support",
    ],
    isPopular: true,
    sortOrder: 2,
  },
  {
    planKey: "enterprise",
    name: "Enterprise",
    description: "For large institutions and groups of schools.",
    monthlyPrice: 1499900,
    yearlyPrice: 14999000,
    trialDays: 0,
    maxStudents: null,
    maxTeachers: null,
    features: [
      "Unlimited students & teachers",
      "AI evaluation at scale",
      "Activity monitoring",
      "Custom branding",
      "Dedicated account manager",
      "24/7 support",
    ],
    isPopular: false,
    sortOrder: 3,
  },
];

const ensureDefaultPlans = async (): Promise<void> => {
  try {
    for (const plan of DEFAULT_PLANS) {
      await Plan.findOrCreate({
        where: { planKey: plan.planKey },
        defaults: { ...plan, currency: config.stripe.currency, isActive: true },
      });
    }
  } catch (e: any) {
    logger.error(`[Plans] Could not create default plans: ${e.message}`);
  }
};

const formatPlan = (plan: Plan) => ({
  planKey: plan.planKey,
  name: plan.name,
  description: plan.description,
  monthlyPrice: plan.monthlyPrice,
  yearlyPrice: plan.yearlyPrice,
  currency: plan.currency,
  trialDays: plan.trialDays,
  maxStudents: plan.maxStudents,
  maxTeachers: plan.maxTeachers,
  features: Array.isArray(plan.features) ? plan.features : [],
  isPopular: plan.isPopular,
  isActive: plan.isActive,
  sortOrder: plan.sortOrder,
  updatedAt: plan.updatedAt,
});

const findPlan = (planKey: string) => Plan.findOne({ where: { planKey } });

// ─── LIST PLANS (super admin sees inactive ones too) ──────────────────────────
const listPlans = async (includeInactive = false): Promise<any> => {
  try {
    const plans = await Plan.findAll({
      where: includeInactive ? {} : { isActive: true },
      order: [["sortOrder", "ASC"], ["id", "ASC"]],
    });

    let subscriberCounts: Record<string, number> = {};
    if (includeInactive) {
      const rows: any[] = await Subscription.findAll({
        attributes: ["planKey", [Subscription.sequelize!.fn("COUNT", "*"), "count"]],
        where: { status: { [Op.in]: ["trialing", "active"] } },
        group: ["planKey"],
        raw: true,
      });
      subscriberCounts = Object.fromEntries(rows.map((r) => [r.planKey, Number(r.count)]));
    }

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Plans fetched successfully.",
      data: {
        plans: plans.map((p) => ({
          ...formatPlan(p),
          ...(includeInactive ? { activeSubscribers: subscriberCounts[p.planKey] || 0 } : {}),
        })),
      },
    };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

// ─── UPDATE A PLAN (super admin) ──────────────────────────────────────────────
// Changes apply to new checkouts and renewals; periods already paid are not touched.
const updatePlan = async (planKey: string, body: any, requestedBy: any): Promise<any> => {
  try {
    const plan = await findPlan(planKey);
    if (!plan) {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Plan not found." };
    }

    if (body.isActive === false && plan.isActive) {
      const activeCount = await Plan.count({ where: { isActive: true } });
      if (activeCount <= 1) {
        return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "At least one plan must stay active." };
      }
    }

    // Stripe refuses charges under its minimum, so a paid price must clear it (0 = free plan).
    const minimum = minChargeFor(plan.currency);
    for (const field of ["monthlyPrice", "yearlyPrice"] as const) {
      const price = body[field];
      if (typeof price === "number" && price > 0 && price < minimum) {
        return {
          error: true,
          statusCode: httpStatus.BAD_REQUEST,
          message: `A paid plan must cost at least ${formatMoney(minimum, plan.currency)} (Stripe's minimum). Use 0 for a free plan.`,
        };
      }
    }

    const before = formatPlan(plan);
    const fields = [
      "name",
      "description",
      "monthlyPrice",
      "yearlyPrice",
      "trialDays",
      "maxStudents",
      "maxTeachers",
      "features",
      "isPopular",
      "isActive",
    ] as const;
    const updates: Record<string, unknown> = {};
    for (const field of fields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }
    updates.updatedBy = requestedBy.userId;

    await Plan.sequelize!.transaction(async (t) => {
      // Only one plan carries the "Most popular" badge.
      if (updates.isPopular === true) {
        await Plan.update({ isPopular: false }, { where: { planKey: { [Op.ne]: planKey } }, transaction: t });
      }
      await plan.update(updates, { transaction: t });
    });

    const after = formatPlan(plan);
    const pricingChanged =
      before.monthlyPrice !== after.monthlyPrice ||
      before.yearlyPrice !== after.yearlyPrice ||
      before.maxStudents !== after.maxStudents ||
      before.maxTeachers !== after.maxTeachers ||
      JSON.stringify(before.features) !== JSON.stringify(after.features);

    if (pricingChanged) {
      void SubscriptionNotifier.notifyPlanSubscribers(plan);
    }

    return { error: false, statusCode: httpStatus.OK, message: "Plan updated successfully.", data: { plan: after } };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

export default { ensureDefaultPlans, listPlans, updatePlan, findPlan, formatPlan };
