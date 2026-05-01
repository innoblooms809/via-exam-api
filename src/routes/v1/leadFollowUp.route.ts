import express from "express";
import { leadFollowUpController } from "../../controllers";


const router = express.Router();
router.route("/create").post(leadFollowUpController.createLeadFollowUp)
router.route("/get/:id").get(leadFollowUpController.getAllFollowUpByLead)

export default router;