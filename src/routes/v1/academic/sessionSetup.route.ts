import { Router } from "express";
import Controller from "../../../controllers/academic/sessionSetup.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ADMINS } from "../../../config/roles";

// What runs in each academic session: sections with class teachers, subjects with subject
// teachers. Master data (classes, sections, subjects) stays in /class, /section, /subject.
const router = Router();
router.use(authenticate, authorize(ADMINS));

router.get("/", Controller.getSetup); // the current session
router.get("/:sessionId", Controller.getSetup);
router.put("/:sessionId/classes/:classId", Controller.saveClass);
router.patch("/:sessionId/sections/:sectionId", Controller.setClassTeacher);
router.patch("/:sessionId/subjects/:subjectId", Controller.setSubjectTeacher);
router.post("/:sessionId/copy", Controller.copySetup);

export default router;
