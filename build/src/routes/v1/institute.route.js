"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const institute_controller_1 = __importDefault(require("../../controllers/institute.controller"));
const auth_1 = require("../../middlewares/auth");
const multer_1 = require("../../utils/multer"); // ← multer middleware for handling logo + banner uploads
const router = (0, express_1.Router)();
// POST /api/viaexam/institute/register
// Protected: only super_admin can create institutes
router.post("/register", auth_1.authenticate, 
//   authorize(["super_admin"]),
multer_1.instituteUpload, institute_controller_1.default.registerInstitute);
// POST /api/viaexam/institute/resendCredentials/:instituteId
// Protected: only super_admin can trigger resend of admin credentials
router.post("/resendCredentials/:instituteId", auth_1.authenticate, 
// authorize(["SUPER_ADMIN"]),   // uncomment if only super-admin should do this
institute_controller_1.default.resendAdminCredentials);
// GET    /api/viaexam/institute/
// Query params: ?page=1&limit=10&search=delhi&plan=pro&status=1
router.get("/getAllInstitutes", auth_1.authenticate, 
//   authorize(["super_admin"]),
institute_controller_1.default.getAllInstitutes);
// GET    /api/viaexam/institute/:instituteId
router.get("/getOneInstitute/:instituteId", auth_1.authenticate, 
//   authorize(["super_admin", "admin"]),
institute_controller_1.default.getInstituteById);
// PUT    /api/viaexam/institute/:instituteId
router.put("/update/:instituteId", auth_1.authenticate, 
//   authorize(["super_admin"]),
multer_1.instituteUpload, // handles new logo/banner if sent
institute_controller_1.default.updateInstitute);
// DELETE /api/viaexam/institute/:instituteId
router.delete("/delete/:instituteId", auth_1.authenticate, 
//   authorize(["super_admin"]),
institute_controller_1.default.softDeleteInstitute);
// PATCH  /api/viaexam/institute/:instituteId/status
router.patch("/:instituteId/status", auth_1.authenticate, 
// authorize(["super_admin"]),
institute_controller_1.default.toggleInstituteStatus);
// GET    /api/viaexam/institute/slug/:slug
// Public: Used on login pages to fetch basic institute info like logo
router.get("/slug/:slug", institute_controller_1.default.getInstituteBySlug);
exports.default = router;
