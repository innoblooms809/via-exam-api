import httpStatus from "http-status";
import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { sequelize } from "../../config/sequelize";
import config from "../../config/config";
import logger from "../../config/logger";
import { getStripe, isStripeConfigured } from "../../config/stripe";
import Institute from "../../models/Institute.model";
import Subscription, { BillingCycle } from "../../models/Subscription.model";
import SubscriptionTransaction from "../../models/SubscriptionTransaction.model";
import PlanService from "./plan.service";
import SubscriptionService, { applyPaidPeriod, buildQuote } from "./subscription.service";
import SubscriptionNotifier, { SUBSCRIPTION_NOTIFICATION, formatDate, formatMoney } from "./subscriptionNotifier";

// A checkout link is valid for 35 minutes (Stripe's minimum is 30), so a quoted price can't go stale for long.
const CHECKOUT_TTL_SECONDS = 35 * 60;

const KIND_LABEL: Record<string, string> = {
  purchase: "subscribed to",
  renewal: "renewed",
  upgrade: "upgraded to",
  downgrade: "switched to",
};

/** Stripe sends the admin back to the page they started from, but only to an origin we trust. */
const resolveAppOrigin = (requestOrigin?: string): string => {
  const fallback = config.frontendUrl.replace(/\/+$/, "");
  if (!requestOrigin) return fallback;
  try {
    const origin = new URL(requestOrigin).origin;
    const trusted = [config.frontendUrl, config.corsOrigin]
      .filter(Boolean)
      .map((u: string) => {
        try {
          return new URL(u).origin;
        } catch {
          return "";
        }
      });
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && config.env !== "production";
    return trusted.includes(origin) || isLocal ? origin : fallback;
  } catch {
    return fallback;
  }
};

const ensureStripeCustomer = async (stripe: Stripe, sub: Subscription, institute: Institute, fresh = false) => {
  if (sub.stripeCustomerId && !fresh) return sub.stripeCustomerId;
  const customer = await stripe.customers.create({
    name: institute.instituteName,
    email: institute.contactEmail,
    phone: institute.contactPhone || undefined,
    metadata: { instituteId: institute.instituteId, slug: institute.slug },
  });
  await sub.update({ stripeCustomerId: customer.id });
  return customer.id;
};

// ─── ADMIN: start a Stripe Checkout ───────────────────────────────────────────
const createCheckout = async (
  requestedBy: any,
  body: { planKey: string; billingCycle: BillingCycle },
  requestOrigin?: string
): Promise<any> => {
  try {
    const instituteId = requestedBy.instituteId;
    const [sub, institute, plan] = await Promise.all([
      SubscriptionService.getOrCreate(instituteId),
      Institute.findOne({ where: { instituteId, isDeleted: false } }),
      PlanService.findPlan(body.planKey),
    ]);
    if (!sub || !institute) return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Institute not found." };
    if (!plan || !plan.isActive) {
      return { error: true, statusCode: httpStatus.BAD_REQUEST, message: "This plan is not available." };
    }

    const quote = await buildQuote(sub, plan, body.billingCycle);
    const transactionId = uuidv4();
    const now = new Date();

    // Nothing to pay (free plan, or unused credit covers the new plan): switch straight away.
    if (quote.amount === 0) {
      const paidByCredit = quote.creditApplied > 0;
      let periodEnd: Date | null = null;
      await sequelize.transaction(async (t) => {
        // The period is worth its full price when credit paid for it, so a later switch credits it correctly.
        const applied = await applyPaidPeriod(sub, plan.planKey, body.billingCycle, quote.originalAmount, t, now);
        periodEnd = applied.periodEnd;
        await SubscriptionTransaction.create(
          {
            transactionId,
            instituteId,
            kind: quote.kind,
            planKey: plan.planKey,
            billingCycle: body.billingCycle,
            originalAmount: quote.originalAmount,
            creditApplied: quote.creditApplied,
            currency: plan.currency,
            status: "paid",
            provider: "system",
            periodStart: applied.periodStart,
            periodEnd: applied.periodEnd,
            paidAt: now,
            createdBy: requestedBy.userId,
            note: paidByCredit ? "Paid with credit from the previous plan" : "Free plan",
          },
          { transaction: t }
        );
      });

      const cycleText = body.billingCycle === "yearly" ? "yearly" : "monthly";
      await SubscriptionNotifier.notifyInstituteAdmins(instituteId, {
        type: SUBSCRIPTION_NOTIFICATION.PLAN_CHANGED,
        title: `Switched to the ${plan.name} plan`,
        message: `Your ${plan.name} plan (${cycleText}) is active until ${formatDate(periodEnd)}.${
          paidByCredit ? " It was paid with credit for unused time on your previous plan." : ""
        }`,
        referenceId: transactionId,
      });
      await SubscriptionNotifier.notifySuperAdmins(instituteId, {
        type: SUBSCRIPTION_NOTIFICATION.PLAN_CHANGED,
        title: `${institute.instituteName} switched to ${plan.name}`,
        message: `${institute.instituteName} moved to the ${plan.name} plan (${cycleText}) until ${formatDate(periodEnd)}${
          paidByCredit ? `, paid with ${formatMoney(quote.creditApplied, plan.currency)} of unused credit` : " (free plan)"
        }.`,
        referenceId: instituteId,
      });
      return { error: false, statusCode: httpStatus.OK, message: "Plan activated.", data: { activated: true } };
    }

    if (!isStripeConfigured()) {
      return {
        error: true,
        statusCode: httpStatus.SERVICE_UNAVAILABLE,
        message: "Online payments are not set up yet. Please contact ViaExam support.",
      };
    }

    const stripe = getStripe();
    const appOrigin = resolveAppOrigin(requestOrigin);
    const billingUrl = `${appOrigin}/${institute.slug}/admin/billing`;
    const cycleLabel = body.billingCycle === "yearly" ? "Yearly" : "Monthly";
    const metadata = { transactionId, instituteId, planKey: plan.planKey, billingCycle: body.billingCycle };

    const tx = await SubscriptionTransaction.create({
      transactionId,
      instituteId,
      kind: quote.kind,
      planKey: plan.planKey,
      billingCycle: body.billingCycle,
      originalAmount: quote.originalAmount,
      creditApplied: quote.creditApplied,
      amount: quote.amount,
      currency: plan.currency,
      status: "pending",
      provider: "stripe",
      periodStart: quote.periodStart,
      periodEnd: quote.periodEnd,
      createdBy: requestedBy.userId,
    });

    const sessionParams = (customer: string): Stripe.Checkout.SessionCreateParams => ({
      mode: "payment",
      customer,
      client_reference_id: instituteId,
      billing_address_collection: "required",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: plan.currency,
            unit_amount: quote.amount,
            product_data: {
              name: `ViaExam ${plan.name} plan (${cycleLabel})`,
              description:
                `Access from ${formatDate(quote.periodStart)} to ${formatDate(quote.periodEnd)}` +
                (quote.creditApplied ? `, includes ${formatMoney(quote.creditApplied, plan.currency)} credit for unused time` : ""),
            },
          },
        },
      ],
      metadata,
      payment_intent_data: {
        description: `${institute.instituteName}: ${plan.name} plan (${cycleLabel})`,
        metadata,
      },
      success_url: `${billingUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${billingUrl}?checkout=cancelled`,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_TTL_SECONDS,
    });

    let session: Stripe.Checkout.Session;
    try {
      try {
        session = await stripe.checkout.sessions.create(sessionParams(await ensureStripeCustomer(stripe, sub, institute)), {
          idempotencyKey: transactionId,
        });
      } catch (err: any) {
        // The saved customer may belong to another Stripe account (e.g. test → live keys): make a new one.
        if (err?.code !== "resource_missing" || err?.param !== "customer") throw err;
        session = await stripe.checkout.sessions.create(
          sessionParams(await ensureStripeCustomer(stripe, sub, institute, true)),
          { idempotencyKey: `${transactionId}-retry` }
        );
      }
    } catch (err: any) {
      await tx.update({ status: "failed", note: `Checkout could not start: ${err.message}` });
      logger.error(`[Checkout] Stripe session failed for ${instituteId}: ${err.message}`);
      return { error: true, statusCode: httpStatus.BAD_GATEWAY, message: "Could not start the payment. Please try again." };
    }

    await tx.update({ stripeSessionId: session.id });
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Checkout started.",
      data: { url: session.url, sessionId: session.id, quote },
    };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

// ─── Fulfilment (webhook and return-page verification both land here) ─────────
const findTransaction = async (session: Stripe.Checkout.Session) =>
  (await SubscriptionTransaction.findOne({ where: { stripeSessionId: session.id } })) ||
  (session.metadata?.transactionId
    ? await SubscriptionTransaction.findOne({ where: { transactionId: session.metadata.transactionId } })
    : null);

/** Idempotent: a session is applied to the subscription at most once, however often it is reported. */
const fulfillSession = async (session: Stripe.Checkout.Session): Promise<{ fulfilled: boolean; status: string }> => {
  if (session.payment_status !== "paid") return { fulfilled: false, status: session.payment_status };

  const tx = await findTransaction(session);
  if (!tx) {
    logger.warn(`[Checkout] No transaction for Stripe session ${session.id}`);
    return { fulfilled: false, status: "unknown" };
  }
  if (tx.status === "paid") return { fulfilled: true, status: "paid" };

  if (session.amount_total !== tx.amount || session.currency !== tx.currency) {
    logger.error(
      `[Checkout] Amount mismatch on ${session.id}: paid ${session.amount_total} ${session.currency}, expected ${tx.amount} ${tx.currency}`
    );
  }

  const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
  const now = new Date();

  const applied = await sequelize.transaction(async (t) => {
    const locked = await SubscriptionTransaction.findOne({ where: { id: tx.id }, lock: t.LOCK.UPDATE, transaction: t });
    if (!locked || locked.status === "paid") return null;
    const sub = await Subscription.findOne({ where: { instituteId: locked.instituteId }, lock: t.LOCK.UPDATE, transaction: t });
    if (!sub) throw new Error(`Subscription missing for institute ${locked.instituteId}`);

    const { periodStart, periodEnd } = await applyPaidPeriod(
      sub,
      locked.planKey,
      (locked.billingCycle || "monthly") as BillingCycle,
      locked.originalAmount,
      t,
      now
    );
    await locked.update(
      { status: "paid", paidAt: now, periodStart, periodEnd, stripePaymentIntentId: paymentIntentId, amount: session.amount_total ?? locked.amount },
      { transaction: t }
    );
    return locked;
  });

  if (!applied) return { fulfilled: true, status: "paid" };

  // Receipt link is a nice-to-have; never fail the payment over it.
  if (paymentIntentId) {
    getStripe()
      .paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] })
      .then((pi) => {
        const charge = pi.latest_charge as Stripe.Charge | null;
        if (charge?.receipt_url) return applied.update({ receiptUrl: charge.receipt_url });
      })
      .catch((e) => logger.warn(`[Checkout] Receipt lookup failed: ${e.message}`));
  }

  const [plan, institute] = await Promise.all([
    PlanService.findPlan(applied.planKey),
    Institute.findOne({ where: { instituteId: applied.instituteId }, attributes: ["instituteName"] }),
  ]);
  const planName = plan?.name || applied.planKey;
  const amount = formatMoney(applied.amount, applied.currency);
  const cycle = applied.billingCycle === "yearly" ? "yearly" : "monthly";

  await SubscriptionNotifier.notifyInstituteAdmins(applied.instituteId, {
    type: SUBSCRIPTION_NOTIFICATION.PAYMENT_SUCCEEDED,
    title: "Payment successful",
    message: `We received ${amount}. Your ${planName} plan (${cycle}) is active until ${formatDate(applied.periodEnd)}.`,
    referenceId: applied.transactionId,
  });
  await SubscriptionNotifier.notifySuperAdmins(applied.instituteId, {
    type: SUBSCRIPTION_NOTIFICATION.PAYMENT_SUCCEEDED,
    title: `${institute?.instituteName || "An institute"} paid ${amount}`,
    message: `${institute?.instituteName || applied.instituteId} ${KIND_LABEL[applied.kind] || "bought"} the ${planName} plan (${cycle}), active until ${formatDate(applied.periodEnd)}.`,
    referenceId: applied.instituteId,
  });

  return { fulfilled: true, status: "paid" };
};

const markSession = async (session: Stripe.Checkout.Session, status: "failed" | "expired") => {
  const tx = await findTransaction(session);
  if (!tx || tx.status !== "pending") return;
  const [count] = await SubscriptionTransaction.update({ status }, { where: { id: tx.id, status: "pending" } });
  if (count !== 1 || status !== "failed") return;

  await SubscriptionNotifier.notifyInstituteAdmins(tx.instituteId, {
    type: SUBSCRIPTION_NOTIFICATION.PAYMENT_FAILED,
    title: "Payment failed",
    message: `Your payment of ${formatMoney(tx.amount, tx.currency)} did not go through. No change was made to your plan; please try again from Billing.`,
    referenceId: tx.transactionId,
  });
  await SubscriptionNotifier.notifySuperAdmins(tx.instituteId, {
    type: SUBSCRIPTION_NOTIFICATION.PAYMENT_FAILED,
    title: "Subscription payment failed",
    message: `A ${formatMoney(tx.amount, tx.currency)} payment for the ${tx.planKey} plan failed (institute ${tx.instituteId}).`,
    referenceId: tx.instituteId,
  });
};

// ─── ADMIN: back from Stripe ──────────────────────────────────────────────────
// Confirms the payment straight away, so it works even before the webhook arrives
// (or when no webhook is configured, e.g. on a laptop).
const verifyCheckout = async (requestedBy: any, sessionId: string): Promise<any> => {
  try {
    if (!isStripeConfigured()) {
      return { error: true, statusCode: httpStatus.SERVICE_UNAVAILABLE, message: "Online payments are not set up." };
    }
    let session: Stripe.Checkout.Session;
    try {
      session = await getStripe().checkout.sessions.retrieve(sessionId);
    } catch {
      return { error: true, statusCode: httpStatus.NOT_FOUND, message: "Payment session not found." };
    }
    if (session.metadata?.instituteId !== requestedBy.instituteId) {
      return { error: true, statusCode: httpStatus.FORBIDDEN, message: "This payment belongs to another institute." };
    }

    const result = await fulfillSession(session);
    const current = await SubscriptionService.getMySubscription(requestedBy);
    return {
      error: false,
      statusCode: httpStatus.OK,
      message: result.fulfilled ? "Payment confirmed." : "Payment is still processing.",
      data: { paymentStatus: result.status, fulfilled: result.fulfilled, ...(current.data || {}) },
    };
  } catch (e: any) {
    return { error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: `Something went wrong: ${e.message}` };
  }
};

// ─── Stripe webhook ───────────────────────────────────────────────────────────
const handleWebhookEvent = async (rawBody: Buffer, signature: string | undefined): Promise<{ statusCode: number; body: any }> => {
  if (!isStripeConfigured() || !config.stripe.webhookSecret) {
    return { statusCode: httpStatus.SERVICE_UNAVAILABLE, body: { error: "Stripe webhook is not configured." } };
  }
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature || "", config.stripe.webhookSecret);
  } catch (err: any) {
    logger.warn(`[Stripe webhook] Signature check failed: ${err.message}`);
    return { statusCode: httpStatus.BAD_REQUEST, body: { error: "Invalid signature." } };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  // Ignore sessions this app didn't create (the Stripe account may be shared).
  if (event.type.startsWith("checkout.session.") && !session.metadata?.transactionId) {
    return { statusCode: httpStatus.OK, body: { received: true, ignored: true } };
  }

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await fulfillSession(session); // throws → 500 → Stripe retries
      break;
    case "checkout.session.async_payment_failed":
      await markSession(session, "failed");
      break;
    case "checkout.session.expired":
      await markSession(session, "expired");
      break;
    default:
      break;
  }
  return { statusCode: httpStatus.OK, body: { received: true } };
};

export default { createCheckout, verifyCheckout, handleWebhookEvent, fulfillSession };
