import { Request, Response } from "express";
import httpStatus from "http-status";
import logger from "../../config/logger";
import PlanService from "../../services/subscription/plan.service";
import SubscriptionService from "../../services/subscription/subscription.service";
import CheckoutService from "../../services/subscription/checkout.service";

type ServiceResult = { statusCode: number; [key: string]: any };

// Every handler sends the service's { error, statusCode, message, data } as is.
const handle =
  (fn: (req: any) => Promise<ServiceResult>) =>
  async (req: Request, res: Response): Promise<any> => {
    try {
      const result = await fn(req);
      return res.status(result.statusCode).send(result);
    } catch (error: any) {
      logger.error(`[Subscription] ${req.method} ${req.originalUrl}: ${error?.message}`);
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "Internal Server Error",
      });
    }
  };

// Plans
const getPublicPlans = handle(() => PlanService.listPlans(false));
const getAllPlans = handle(() => PlanService.listPlans(true));
const updatePlan = handle((req) => PlanService.updatePlan(req.params.planKey, req.body, req.viaExamUser));

// Institute admin
const getMySubscription = handle((req) => SubscriptionService.getMySubscription(req.viaExamUser));
const getQuote = handle((req) => SubscriptionService.getQuote(req.viaExamUser, req.body));
const createCheckout = handle((req) =>
  CheckoutService.createCheckout(req.viaExamUser, req.body, req.headers.origin as string | undefined)
);
const verifyCheckout = handle((req) => CheckoutService.verifyCheckout(req.viaExamUser, req.body.sessionId));

// Super admin
const getOverview = handle(() => SubscriptionService.getOverview());
const listSubscriptions = handle((req) => SubscriptionService.listSubscriptions(req.query));
const getInstituteSubscription = handle((req) => SubscriptionService.getInstituteSubscription(req.params.instituteId));
const updateInstituteSubscription = handle((req) =>
  SubscriptionService.updateInstituteSubscription(req.params.instituteId, req.body, req.viaExamUser)
);
const listTransactions = handle((req) => SubscriptionService.listTransactions(req.query));

// Stripe webhook: req.body is the raw Buffer (see app.ts) so the signature can be checked.
const stripeWebhook = async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await CheckoutService.handleWebhookEvent(req.body as Buffer, req.headers["stripe-signature"] as string);
    return res.status(result.statusCode).json(result.body);
  } catch (error: any) {
    logger.error(`[Stripe webhook] Handling failed: ${error?.message}`);
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ error: "Webhook handling failed." });
  }
};

export default {
  getPublicPlans,
  getAllPlans,
  updatePlan,
  getMySubscription,
  getQuote,
  createCheckout,
  verifyCheckout,
  getOverview,
  listSubscriptions,
  getInstituteSubscription,
  updateInstituteSubscription,
  listTransactions,
  stripeWebhook,
};
