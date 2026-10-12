import { Op } from "sequelize";
import Notification from "../../models/Notification.model";
import User from "../../models/User.model";
import Role from "../../models/Role.model";
import Subscription from "../../models/Subscription.model";
import type Plan from "../../models/Plan.model";
import logger from "../../config/logger";
import { invalidate } from "../../utils/memoCache";
import { newId } from "../../utils/idGenerator";

// Notification types the UI uses to route a click to the billing pages.
export const SUBSCRIPTION_NOTIFICATION = {
  TRIAL_STARTED: "SUBSCRIPTION_TRIAL_STARTED",
  PAYMENT_SUCCEEDED: "SUBSCRIPTION_PAYMENT_SUCCEEDED",
  PAYMENT_FAILED: "SUBSCRIPTION_PAYMENT_FAILED",
  PLAN_CHANGED: "SUBSCRIPTION_PLAN_CHANGED",
  EXPIRING: "SUBSCRIPTION_EXPIRING",
  EXPIRED: "SUBSCRIPTION_EXPIRED",
  PLAN_UPDATED: "SUBSCRIPTION_PLAN_UPDATED",
} as const;

const ADMIN_ROLES = ["ADMIN", "INSTITUTE_ADMIN"];
const SUPER_ADMIN_ROLES = ["SUPER_ADMIN"];

interface NotificationPayload {
  type: string;
  title: string;
  message: string;
  referenceId?: string | null;
}

export const formatMoney = (minor: number, currency: string): string => {
  const major = (minor || 0) / 100;
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: Number.isInteger(major) ? 0 : 2,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${major.toFixed(2)}`;
  }
};

export const formatDate = (date: Date | string | null | undefined): string => {
  if (!date) return "-";
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
};

const findUserIds = async (roles: string[], instituteId?: string): Promise<string[]> => {
  const users = await User.findAll({
    attributes: ["userId"],
    where: instituteId ? { instituteId } : {},
    include: [{ model: Role, as: "role", attributes: [], where: { role: { [Op.in]: roles } } }],
  });
  return users.map((u: any) => u.userId);
};

// One Notification row per user: its afterCreate hook also sends the browser push.
const createFor = async (userIds: string[], instituteId: string, payload: NotificationPayload) => {
  for (const userId of userIds) {
    try {
      await Notification.create({
        notificationId: newId("notification"),
        instituteId,
        userId,
        type: payload.type,
        title: payload.title,
        message: payload.message,
        referenceId: payload.referenceId ?? instituteId,
      });
    } catch (e: any) {
      logger.error(`[Subscription] Could not notify ${userId}: ${e.message}`);
    }
  }
};

const notifyInstituteAdmins = async (instituteId: string, payload: NotificationPayload) => {
  try {
    await createFor(await findUserIds(ADMIN_ROLES, instituteId), instituteId, payload);
  } catch (e: any) {
    logger.error(`[Subscription] Admin notification failed: ${e.message}`);
  }
};

// Super admins have no institute; the notification is filed under the institute it is about.
const notifySuperAdmins = async (instituteId: string, payload: NotificationPayload) => {
  // Every event worth telling super admins about (new institute, payment, expiry) changes their dashboard.
  invalidate("sa-dash:");
  try {
    await createFor(await findUserIds(SUPER_ADMIN_ROLES), instituteId, payload);
  } catch (e: any) {
    logger.error(`[Subscription] Super admin notification failed: ${e.message}`);
  }
};

// Plan price/limits/features changed: tell every institute currently on it.
const notifyPlanSubscribers = async (plan: Plan) => {
  try {
    const subs = await Subscription.findAll({
      attributes: ["instituteId"],
      where: { planKey: plan.planKey, status: { [Op.in]: ["trialing", "active"] } },
    });
    for (const sub of subs) {
      await notifyInstituteAdmins(sub.instituteId, {
        type: SUBSCRIPTION_NOTIFICATION.PLAN_UPDATED,
        title: `${plan.name} plan updated`,
        message: `The ${plan.name} plan now costs ${formatMoney(plan.monthlyPrice, plan.currency)}/month or ${formatMoney(plan.yearlyPrice, plan.currency)}/year. Your current paid period is not affected; new prices apply from your next renewal.`,
      });
    }
  } catch (e: any) {
    logger.error(`[Subscription] Plan update notification failed: ${e.message}`);
  }
};

export default { notifyInstituteAdmins, notifySuperAdmins, notifyPlanSubscribers };
