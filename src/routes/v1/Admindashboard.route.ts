import { Router } from "express";

import Controller from "../../controllers/Admindashboard.controller";

import { authenticate } from "../../middlewares/auth";

const router = Router();

router.get(
  "/overview",
  authenticate,
  Controller.getOverview
);

export default router;