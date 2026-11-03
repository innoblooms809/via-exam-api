import { Router } from "express";
import Controller from "../../../controllers/partner/partner.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { partnerRateLimit, partnerRequestId, requirePartnerKey } from "../../../middlewares/partnerAuth";

// ─── /v1/partner — the evaluation API for partners (API key) ──────────────────────
// Documented in /v1/partner/openapi.json (src/docs/partnerOpenApi.ts).
export const partnerRoutes = Router();

partnerRoutes.use(partnerRequestId);
partnerRoutes.get("/openapi.json", Controller.openApi);
partnerRoutes.get("/capabilities", requirePartnerKey(), partnerRateLimit, Controller.capabilities);
partnerRoutes.post("/evaluations", requirePartnerKey("evaluations:write"), partnerRateLimit, Controller.createEvaluation);
partnerRoutes.get("/evaluations", requirePartnerKey("evaluations:read"), partnerRateLimit, Controller.listEvaluations);
partnerRoutes.get("/evaluations/:evaluationId", requirePartnerKey("evaluations:read"), partnerRateLimit, Controller.getEvaluation);
partnerRoutes.post("/evaluations/:evaluationId/cancel", requirePartnerKey("evaluations:write"), partnerRateLimit, Controller.cancelEvaluation);

// ─── /v1/partner-keys — key management (super admin) ──────────────────────────────
export const partnerKeyRoutes = Router();
const superAdminOnly = authorize(["SUPER_ADMIN"]);

partnerKeyRoutes.get("/", authenticate, superAdminOnly, Controller.listKeys);
partnerKeyRoutes.post("/", authenticate, superAdminOnly, Controller.createKey);
partnerKeyRoutes.patch("/:keyId", authenticate, superAdminOnly, Controller.updateKey);
partnerKeyRoutes.post("/:keyId/revoke", authenticate, superAdminOnly, Controller.revokeKey);
partnerKeyRoutes.post("/:keyId/rotate-webhook-secret", authenticate, superAdminOnly, Controller.rotateWebhookSecret);
