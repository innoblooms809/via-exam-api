import { Router } from "express";
import { getHealth } from "../../controllers/health.controller";

const router = Router();

/**
 * GET /v1/health
 * Public endpoint — no auth required
 */
router.get("/", getHealth);

export default router;
