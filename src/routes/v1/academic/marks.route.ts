import { Router } from "express";
import Controller from "../../../controllers/academic/marks.controller";
import { authenticate, authorize } from "../../../middlewares/auth";
import { ACADEMIC, ADMINS } from "../../../config/roles";

// /marks — each subject's marks per exam and session (Master Data → Marks & grading).
export const marksRoutes = Router();
marksRoutes.use(authenticate);
marksRoutes.get("/", authorize(ADMINS), Controller.getMarks);
marksRoutes.put("/", authorize(ADMINS), Controller.saveMarks);
marksRoutes.post("/copy", authorize(ADMINS), Controller.copyMarks);
marksRoutes.get("/changes", authorize(ADMINS), Controller.getChanges);

// /institute-settings — the school's rules: grade bands, starting marks, cross-checking, scan quality.
export const settingsRoutes = Router();
settingsRoutes.use(authenticate);
// Teachers read the rules too (e.g. which papers go for cross-checking).
settingsRoutes.get("/", authorize(ACADEMIC), Controller.getSettings);
settingsRoutes.put("/grading-scale", authorize(ADMINS), Controller.saveGradingScale);
settingsRoutes.put("/marks-defaults", authorize(ADMINS), Controller.saveMarksDefaults);
settingsRoutes.put("/cross-check", authorize(ADMINS), Controller.saveCrossCheck);
// When an uploaded answer sheet is flagged as a poor scan (DPI, blur, faint ink).
settingsRoutes.put("/scan-quality", authorize(ADMINS), Controller.saveScanQuality);
// The printed result sheet: header (from the institute profile unless replaced), columns, signatures…
settingsRoutes.get("/result-sheet", authorize(ADMINS), Controller.getResultSheet);
settingsRoutes.put("/result-sheet", authorize(ADMINS), Controller.saveResultSheet);
settingsRoutes.delete("/result-sheet", authorize(ADMINS), Controller.resetResultSheet);
