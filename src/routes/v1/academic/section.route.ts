import express from "express";
import SectionController from "../../../controllers/academic/section.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS, MEMBERS } from "../../../config/roles";

const router = express.Router();

router.post("/createSection", authenticate, authorize(ADMINS), SectionController.createSection);
router.get("/allSections", authenticate, authorize(MEMBERS), SectionController.getAllSections);
router.get("/getSection/:sectionId", authenticate, authorize(MEMBERS), SectionController.getSectionById);
router.patch("/updateSection/:sectionId", authenticate, authorize(ADMINS), SectionController.updateSection);
router.delete("/deleteSection/:sectionId", authenticate, authorize(ADMINS), SectionController.deleteSection);

export default router;
