import { NextFunction, Response, Router } from "express";
import httpStatus from "http-status";
import Controller from "../../../controllers/institute/institute.controller";
import { authenticate, authorize, normalizeRoleKey } from "../../../middlewares/auth";
import Institute from "../../../models/Institute.model";
import { instituteUpload } from "../../../utils/multer"; // logo only (bytes checked, 2 MB)
import validate from "../../../middlewares/validate";
import InstituteValidation from "../../../validations/institute.validation";

const router = Router();

// ── Access rules ──────────────────────────────────────────────────────────────
// Creating, deleting, suspending institutes and managing their admin accounts is for
// super admins only. Institute users may read their own institute; only that
// institute's admins may edit it (and not its plan or URL slug — see the controller).

const superAdminOnly = authorize(["SUPER_ADMIN"]);
const ADMIN_ROLES = new Set(["admin", "instituteadmin"]);

const forbid = (res: Response) =>
  res.status(httpStatus.FORBIDDEN).json({
    error: true,
    statusCode: httpStatus.FORBIDDEN,
    message: "You can only access your own institute.",
  });

/** Super admins pass; everyone else only for the institute in :instituteId (numeric id or instituteId). */
const ownInstitute =
  ({ adminsOnly = false } = {}) =>
  async (req: any, res: Response, next: NextFunction): Promise<any> => {
    const user = req.viaExamUser;
    const role = normalizeRoleKey(user?.role?.role);
    if (role === "superadmin") return next();
    if (adminsOnly && !ADMIN_ROLES.has(role)) return forbid(res);

    const own = String(user?.instituteId || "");
    const param = String(req.params.instituteId || "");
    if (!own || !param) return forbid(res);
    if (param === own) return next();
    if (/^\d+$/.test(param)) {
      const inst = await Institute.findOne({ where: { id: Number(param) }, attributes: ["instituteId"] }).catch(() => null);
      if (inst?.instituteId === own) return next();
    }
    return forbid(res);
  };

// POST /v1/institute/register — super admin creates an institute (+ its admin)
router.post("/register", authenticate, superAdminOnly, instituteUpload, Controller.registerInstitute);

// POST /v1/institute/addAdmin/:instituteId
router.post("/addAdmin/:instituteId", authenticate, superAdminOnly, validate(InstituteValidation.addAdmin), Controller.addInstituteAdmin);

// POST /v1/institute/resendCredentials/:instituteId — new password is generated on the server and emailed
router.post("/resendCredentials/:instituteId", authenticate, superAdminOnly, Controller.resendAdminCredentials);

// GET /v1/institute/getAllInstitutes?page=1&limit=10&search=delhi&plan=pro&status=1
// Super admins see every institute; other users only their own.
router.get("/getAllInstitutes", authenticate, Controller.getAllInstitutes);

// GET /v1/institute/getOneInstitute/:instituteId
router.get("/getOneInstitute/:instituteId", authenticate, ownInstitute(), Controller.getInstituteById);

// PUT /v1/institute/update/:instituteId
router.put("/update/:instituteId", authenticate, ownInstitute({ adminsOnly: true }), instituteUpload, Controller.updateInstitute);

// DELETE /v1/institute/delete/:instituteId
router.delete("/delete/:instituteId", authenticate, superAdminOnly, Controller.softDeleteInstitute);

// PATCH /v1/institute/:instituteId/status  { status: 0 | 1 }
router.patch("/:instituteId/status", authenticate, superAdminOnly, Controller.toggleInstituteStatus);

// GET /v1/institute/credentials/:instituteId — the institute admin's login email
router.get("/credentials/:instituteId", authenticate, ownInstitute({ adminsOnly: true }), Controller.getInstituteCredentials);

// GET /v1/institute/slug/:slug
// Public: Used on login pages to fetch basic institute info like logo
router.get("/slug/:slug", Controller.getInstituteBySlug);

export default router;
