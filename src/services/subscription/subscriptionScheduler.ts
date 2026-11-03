import { Op } from "sequelize";
import logger from "../../config/logger";
import Institute from "../../models/Institute.model";
import Subscription from "../../models/Subscription.model";
import PlanService from "./plan.service";
import SubscriptionService, { accessEndsAt } from "./subscription.service";
import SubscriptionNotifier, { SUBSCRIPTION_NOTIFICATION, formatDate } from "./subscriptionNotifier";
import { defineMaintenanceTask, runMaintenanceTaskNow } from "../../queue/maintenance";

const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_EVERY_MS = 60 * 60 * 1000; // hourly
const FIRST_RUN_DELAY_MS = 30 * 1000;
// Admins are reminded 7, 3 and 1 day(s) before access ends; super admins at 3 days.
const REMINDER_DAYS = [1, 3, 7];
const SUPER_ADMIN_REMINDER_DAYS = 3;

const sendReminders = async (): Promise<void> => {
  const now = new Date();
  const horizon = new Date(now.getTime() + Math.max(...REMINDER_DAYS) * DAY_MS);
  const subs = await Subscription.findAll({
    where: {
      [Op.or]: [
        { status: "trialing", trialEndsAt: { [Op.between]: [now, horizon] } },
        { status: "active", currentPeriodEnd: { [Op.between]: [now, horizon] } },
      ],
    },
    include: [{ model: Institute, as: "institute", attributes: ["instituteName"], where: { isDeleted: false } }],
  });

  for (const sub of subs) {
    const ends = accessEndsAt(sub);
    if (!ends) continue;
    const daysLeft = Math.ceil((new Date(ends).getTime() - now.getTime()) / DAY_MS);
    const bucket = REMINDER_DAYS.find((d) => daysLeft <= d);
    if (!bucket) continue;

    // Claim this reminder atomically; a renewal resets lastReminderKey, and a new end date gives a new key.
    const key = `${sub.status}:${bucket}:${new Date(ends).toISOString()}`;
    const [claimed] = await Subscription.update(
      { lastReminderKey: key },
      { where: { id: sub.id, [Op.or]: [{ lastReminderKey: null }, { lastReminderKey: { [Op.ne]: key } }] } }
    );
    if (claimed !== 1) continue;

    const plan = await PlanService.findPlan(sub.planKey);
    const planName = plan?.name || sub.planKey;
    const when = daysLeft <= 1 ? "tomorrow" : `in ${daysLeft} days`;
    const what = sub.status === "trialing" ? "free trial" : "subscription";
    const name = (sub as any).institute?.instituteName || sub.instituteId;

    await SubscriptionNotifier.notifyInstituteAdmins(sub.instituteId, {
      type: SUBSCRIPTION_NOTIFICATION.EXPIRING,
      title: `Your ${what} ends ${when}`,
      message:
        sub.status === "trialing"
          ? `Your ${planName} free trial ends on ${formatDate(ends)}. Choose a plan in Billing to continue without interruption.`
          : `Your ${planName} plan ends on ${formatDate(ends)}. Renew now in Billing to avoid any interruption.`,
    });
    if (bucket === SUPER_ADMIN_REMINDER_DAYS) {
      await SubscriptionNotifier.notifySuperAdmins(sub.instituteId, {
        type: SUBSCRIPTION_NOTIFICATION.EXPIRING,
        title: `${name}: ${what} ends ${when}`,
        message: `${name}'s ${planName} ${what} ends on ${formatDate(ends)}.`,
      });
    }
  }
};

const maintain = async () => {
  const expired = await SubscriptionService.expireDueSubscriptions();
  if (expired) logger.info(`[Subscription] Marked ${expired} subscription(s) as expired`);
  await sendReminders();
  return { expired };
};

const runMaintenance = async (): Promise<void> => {
  try {
    await maintain();
  } catch (e: any) {
    logger.error(`[Subscription] Maintenance run failed: ${e.message}`);
  }
};

// Expiry and reminders run hourly as a scheduled job (queue/maintenance.ts): one run per hour
// however many API instances there are, and a failed run is retried. Reminders are claimed
// atomically (lastReminderKey), so a retried run never sends one twice.
defineMaintenanceTask("subscription-maintenance", { everyMs: RUN_EVERY_MS }, maintain);

/** Seeds plans and gives existing institutes a subscription; the hourly checks are scheduled. */
export const startSubscriptionScheduler = async (): Promise<void> => {
  await PlanService.ensureDefaultPlans();
  await SubscriptionService.backfillSubscriptions();
  // The first check soon after start, as before; then the hourly schedule.
  setTimeout(() => void runMaintenanceTaskNow("subscription-maintenance").catch(() => runMaintenance()), FIRST_RUN_DELAY_MS).unref();
};

export default { startSubscriptionScheduler, runMaintenance };
