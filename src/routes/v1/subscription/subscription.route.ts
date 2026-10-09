import { Router } from "express";
import Controller from "../../../controllers/subscription/subscription.controller";
import { authenticate, authorize, verifyTenant } from "../../../middlewares/auth";
import validate from "../../../middlewares/validate";
import Validation from "../../../validations/subscription.validation";

// POST /v1/subscription/webhook (Stripe) is mounted in app.ts: it needs the raw body.
const router = Router();

const superAdmin = [authenticate, authorize(["SUPER_ADMIN"])];
const instituteAdmin = [authenticate, authorize(["ADMIN", "INSTITUTE_ADMIN"]), verifyTenant];

// ── Public ────────────────────────────────────────────────────────────────────
// GET /v1/subscription/plans/public — active plans (pricing pages)
router.get("/plans/public", Controller.getPublicPlans);

// ── Institute admin ───────────────────────────────────────────────────────────
// GET  /v1/subscription/me                — current plan, usage, payment history
// POST /v1/subscription/quote             — price for a plan change/renewal { planKey, billingCycle }
// POST /v1/subscription/checkout          — start Stripe Checkout, returns { url }
// POST /v1/subscription/checkout/verify   — confirm payment on return { sessionId }
router.get("/me", ...instituteAdmin, Controller.getMySubscription);
router.post("/quote", ...instituteAdmin, validate(Validation.checkout), Controller.getQuote);
router.post("/checkout", ...instituteAdmin, validate(Validation.checkout), Controller.createCheckout);
router.post("/checkout/verify", ...instituteAdmin, validate(Validation.verifyCheckout), Controller.verifyCheckout);

// ── Super admin ───────────────────────────────────────────────────────────────
router.get("/plans", ...superAdmin, Controller.getAllPlans);
router.put("/plans/:planKey", ...superAdmin, validate(Validation.updatePlan), Controller.updatePlan);
router.get("/overview", ...superAdmin, Controller.getOverview);
router.get("/institutes", ...superAdmin, validate(Validation.listSubscriptions), Controller.listSubscriptions);
router.get(
  "/institutes/:instituteId",
  ...superAdmin,
  validate(Validation.instituteParams),
  Controller.getInstituteSubscription
);
router.patch(
  "/institutes/:instituteId",
  ...superAdmin,
  validate(Validation.updateInstituteSubscription),
  Controller.updateInstituteSubscription
);
router.get("/transactions", ...superAdmin, validate(Validation.listTransactions), Controller.listTransactions);

export default router;
