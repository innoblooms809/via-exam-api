import express from "express";
import SectionController from "../../controllers/section.controller";
import { authenticate, authorize } from "../../middlewares/auth";

const router = express.Router();

router.post(
  "/createSection",
  authenticate,
  // authorize(["ADMIN"]),
  SectionController.createSection
);

router.get(
  "/allSections",
  authenticate,
//   authorize(["ADMIN"]),
  SectionController.getAllSections
);

router.get(
  "/getSection/:sectionId",
  authenticate,
//   authorize(["ADMIN"]),
  SectionController.getSectionById
);

router.patch(
  "/updateSection/:sectionId",
  authenticate,
//   authorize(["ADMIN"]),
  SectionController.updateSection
);

router.delete(
  "/deleteSection/:sectionId",
  authenticate,
//   authorize(["ADMIN"]),
  SectionController.deleteSection
);

export default router;