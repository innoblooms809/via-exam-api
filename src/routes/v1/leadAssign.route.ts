import express from "express";
import leadController from "../../controllers/lead.controller";
import leadservice from "../../services/leadservice";
import leadAssignController from "../../controllers/leadAssign.controller";
const router = express.Router();
router.route("/create").post(leadAssignController.createLeadAssign);

export default router;
