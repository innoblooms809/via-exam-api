import { Router } from "express";
import Controller from "../../controllers/institute.controller";
import {authenticate,authorize } from "../../middlewares/auth";
import { instituteUpload } from "../../utils/multer"; // ← multer middleware for handling logo + banner uploads

const router = Router();

// POST /api/viaexam/institute/register
// Protected: only super_admin can create institutes
router.post(
  "/register",
//   authenticate,
//   authorize(["super_admin"]),
  instituteUpload,
  Controller.registerInstitute
);

// GET    /api/viaexam/institute/
// Query params: ?page=1&limit=10&search=delhi&plan=pro&status=1
router.get(
  "/getAllInstitutes",
//   authenticate,
//   authorize(["super_admin"]),
  Controller.getAllInstitutes
);

// GET    /api/viaexam/institute/:instituteId
router.get(
  "/getOneInstitute/:instituteId",
//   authenticate,
//   authorize(["super_admin", "admin"]),
  Controller.getInstituteById
);

// PUT    /api/viaexam/institute/:instituteId
router.put(
  "/update/:instituteId",
  authenticate,
//   authorize(["super_admin"]),
  instituteUpload,           // handles new logo/banner if sent
  Controller.updateInstitute
);

// DELETE /api/viaexam/institute/:instituteId
router.delete(
  "/delete/:instituteId",
//   authenticate,
//   authorize(["super_admin"]),
  Controller.softDeleteInstitute
);

// PATCH  /api/viaexam/institute/:instituteId/status
router.patch(
  "/:instituteId/status",
  authenticate,
  authorize(["super_admin"]),
  Controller.toggleInstituteStatus
);

export default router;