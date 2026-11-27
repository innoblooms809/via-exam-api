import httpStatus from "http-status";
import { Op } from "sequelize";
import config from "../../config/config";
import logger from "../../config/logger";
import Institute from "../../models/Institute.model";
import Notification from "../../models/Notification.model";
import Role from "../../models/Role.model";
import User from "../../models/User.model";
import { escapeHtml, queueEmail } from "../../utils/mailHelper";
import PlanService from "./plan.service";
import SubscriptionService, { accessEndsAt, effectiveStatus } from "./subscription.service";
import SubscriptionNotifier, { formatDate } from "./subscriptionNotifier";

/**
 * A super admin reminds an institute's admins, by hand, that its plan is ending or has ended:
 * an email to each active admin (with a link to Billing) and an in-app notification (which
 * also pushes). The hourly job already reminds at 7, 3 and 1 day(s); this is the extra nudge.
 *
 * At most one per institute per REMINDER_COOLDOWN_H, so admins aren't flooded; the in-app
 * notification (type SUBSCRIPTION_REMINDER) is the record of when the last one went out.
 */

export const SUBSCRIPTION_REMINDER = "SUBSCRIPTION_REMINDER";
const REMINDER_COOLDOWN_H = 24;
const ADMIN_ROLES = ["ADMIN", "INSTITUTE_ADMIN"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** When the last manual reminder was sent to this institute, or null. */
export const lastReminderAt = async (instituteId: string): Promise<Date | null> => {
  const last = await Notification.findOne({
    where: { instituteId, type: SUBSCRIPTION_REMINDER },
    attributes: ["createdAt"],
    order: [["createdAt", "DESC"]],
  });
  return last?.createdAt ?? null;
};

const sendReminder = async (instituteId: string, requestedBy: any) => {
  try {
    const institute = await Institute.findOne({ where: { instituteId, isDeleted: false } });
    if (!institute) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Institute not found." };
    if (Number(institute.status) !== 1) {
      return {
        error: true,
        statusCode: httpStatus.CONFLICT,
        message: "This institute is suspended, so its admins can't sign in to renew. Reactivate it first.",
      };
    }

    const last = await lastReminderAt(instituteId);
    if (last && Date.now() - new Date(last).getTime() < REMINDER_COOLDOWN_H * 3600 * 1000) {
      const nextAt = new Date(new Date(last).getTime() + REMINDER_COOLDOWN_H * 3600 * 1000);
      return {
        error: true,
        statusCode: httpStatus.TOO_MANY_REQUESTS,
        message: `A reminder was already sent on ${formatDate(last)}. You can send another after ${nextAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}.`,
        data: { lastReminderAt: last },
      };
    }

    const sub = await SubscriptionService.getOrCreate(instituteId);
    if (!sub) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "This institute has no subscription." };

    const admins = await User.findAll({
      attributes: ["userId", "userName", "emailId"],
      where: { instituteId, status: 1, isDeleted: false },
      include: [{ model: Role, as: "role", attributes: [], where: { role: { [Op.in]: ADMIN_ROLES } } }],
    });
    if (!admins.length) {
      return { error: true, statusCode: httpStatus.CONFLICT, message: "This institute has no active admin to remind. Add an admin first." };
    }

    // What to say: still running (ends in N days) or already ended.
    const now = new Date();
    const status = effectiveStatus(sub, now);
    const live = status === "trialing" || status === "active";
    const ends = accessEndsAt(sub);
    const plan = await PlanService.findPlan(sub.planKey);
    const planName = plan?.name || sub.planKey;
    const what = status === "trialing" || (!sub.billingCycle && !live) ? "free trial" : `${planName} plan`;
    const daysLeft = live && ends ? Math.max(0, Math.ceil((new Date(ends).getTime() - now.getTime()) / DAY_MS)) : null;
    const when = daysLeft === null ? "" : daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;

    const title = live ? `Reminder: your ${what} ends ${when}` : `Reminder: your ${what} has ended`;
    const message = live
      ? `Your ${what} ends on ${formatDate(ends)}. Renew in Billing to keep using ViaExam without interruption.`
      : status === "cancelled"
        ? `Your subscription was cancelled. Renew in Billing to restore full access to ViaExam.`
        : `Your ${what} ended on ${formatDate(ends)}. Choose a plan in Billing to keep using ViaExam.`;
    const billingUrl = `${config.frontendUrl}/${institute.slug}/admin/billing`;

    // In-app (and push) first: it is also the record the cooldown reads.
    await SubscriptionNotifier.notifyInstituteAdmins(instituteId, { type: SUBSCRIPTION_REMINDER, title, message });

    let emailed = 0;
    for (const admin of admins as any[]) {
      const to = String(admin.emailId ?? "").trim();
      if (!to) continue;
      await queueEmail({
        kind: "subscription-reminder",
        message: {
          to,
          subject: `${title} · ${institute.instituteName}`.slice(0, 200),
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#101828;max-width:560px">
              <p>Hello ${escapeHtml(admin.userName || "there")},</p>
              <p>${escapeHtml(message)}</p>
              <p style="margin:24px 0">
                <a href="${escapeHtml(billingUrl)}" style="background:#4f6ef7;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Renew in Billing</a>
              </p>
              <p style="color:#667085;font-size:13px">Institute: ${escapeHtml(institute.instituteName)}${ends ? ` · ${live ? "Access ends" : "Access ended"}: ${escapeHtml(formatDate(ends))}` : ""}</p>
              <p style="color:#667085;font-size:13px">If you have already renewed, you can ignore this email. Questions? Just reply to the ViaExam team.</p>
            </div>`,
        },
      });
      emailed++;
    }

    logger.info(`[Subscription] Manual reminder for ${instituteId} sent to ${emailed} admin(s) by ${requestedBy?.userId ?? "a super admin"}.`);
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: `Reminder sent to ${emailed} admin${emailed === 1 ? "" : "s"} by email and in-app notification.`,
      data: { sentTo: emailed, lastReminderAt: new Date() },
    };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

export default { sendReminder, lastReminderAt };
