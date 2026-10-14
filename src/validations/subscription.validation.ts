import Joi from "joi";

// Money is in minor units (paise): ₹1,999 → 199900.
const amount = Joi.number().integer().min(0).max(1_000_000_000);
const planKey = Joi.string().trim().lowercase().max(32).pattern(/^[a-z0-9_-]+$/);
const billingCycle = Joi.string().valid("monthly", "yearly");
const limit = Joi.number().integer().min(1).max(1_000_000).allow(null);

const planParams = { params: Joi.object({ planKey: planKey.required() }) };
const instituteParams = { params: Joi.object({ instituteId: Joi.string().trim().max(64).required() }) };

const updatePlan = {
  ...planParams,
  body: Joi.object({
    name: Joi.string().trim().min(2).max(60),
    description: Joi.string().trim().max(300).allow("", null),
    monthlyPrice: amount,
    yearlyPrice: amount,
    trialDays: Joi.number().integer().min(0).max(365),
    maxStudents: limit,
    maxTeachers: limit,
    features: Joi.array().items(Joi.string().trim().min(1).max(120)).max(20),
    isPopular: Joi.boolean(),
    isActive: Joi.boolean(),
  }).min(1),
};

const checkout = {
  body: Joi.object({
    planKey: planKey.required(),
    billingCycle: billingCycle.required(),
  }),
};

const verifyCheckout = {
  body: Joi.object({
    sessionId: Joi.string().trim().max(255).pattern(/^cs_/).required(),
  }),
};

const listSubscriptions = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    search: Joi.string().trim().max(100).allow(""),
    status: Joi.string().valid("trialing", "active", "expired", "cancelled").allow(""),
    planKey: planKey.allow(""),
    expiringSoon: Joi.string().valid("true", "false"),
  }),
};

const listTransactions = {
  query: Joi.object({
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    search: Joi.string().trim().max(100).allow(""),
    status: Joi.string().valid("pending", "paid", "failed", "expired").allow(""),
    provider: Joi.string().valid("stripe", "manual", "system").allow(""),
    instituteId: Joi.string().trim().max(64).allow(""),
    kind: Joi.string().valid("purchase", "renewal", "upgrade", "downgrade", "manual").allow(""),
    from: Joi.date().iso(),
    to: Joi.date().iso(),
  }),
};

const updateInstituteSubscription = {
  ...instituteParams,
  body: Joi.object({
    status: Joi.string().valid("active", "trialing", "cancelled", "expired").required(),
    planKey,
    billingCycle,
    accessEndsAt: Joi.date().iso().allow(null),
    amountPaid: amount,
    note: Joi.string().trim().max(500).allow(""),
  }),
};

export default {
  updatePlan,
  checkout,
  verifyCheckout,
  listSubscriptions,
  listTransactions,
  instituteParams,
  updateInstituteSubscription,
};
