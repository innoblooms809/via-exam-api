import httpStatus from "http-status";
import { Response } from "express";
import { normalizeRoleKey } from "../../middlewares/auth";
import InstituteService from "../../services/institute/institute.service";

const registerInstitute = async (req: any, res: Response): Promise<any> => {
  try {
    // req.files comes from multer
    const result = await InstituteService.registerInstitute(
      req.body,
      req.files,
    );

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// RESEND ADMIN CREDENTIALS
const resendAdminCredentials = async (req: any, res: Response): Promise<any> => {
  try {
    // The password is always generated on the server; a client-chosen one is never accepted.
    const result = await InstituteService.resendAdminCredentials(req.params.instituteId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── Get All ──────────────────────────────────────────────────────────────────
const getAllInstitutes = async (req: any, res: Response): Promise<any> => {
  try {
    // Only super admins may list every institute; anyone else gets their own.
    const isSuperAdmin = normalizeRoleKey(req.viaExamUser?.role?.role) === "superadmin";
    const query = isSuperAdmin ? req.query : { ...req.query, onlyInstituteId: req.viaExamUser?.instituteId || "__none__" };
    const result = await InstituteService.getAllInstitutes(query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── Get One ──────────────────────────────────────────────────────────────────
const getInstituteById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await InstituteService.getInstituteById(
      req.params.instituteId,
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── Update ───────────────────────────────────────────────────────────────────
const updateInstitute = async (req: any, res: Response): Promise<any> => {
  try {
    // Plan (billing) and slug (every login URL) are changed by super admins only.
    const body = { ...req.body };
    if (normalizeRoleKey(req.viaExamUser?.role?.role) !== "superadmin") {
      delete body.plan;
      delete body.slug;
    }
    const result = await InstituteService.updateInstitute(req.params.instituteId, body, req.files);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── Soft Delete ──────────────────────────────────────────────────────────────
const softDeleteInstitute = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await InstituteService.softDeleteInstitute(
      req.params.instituteId,
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── Toggle Status ────────────────────────────────────────────────────────────
const toggleInstituteStatus = async (req: any, res: Response): Promise<any> => {
  try {
    const { status } = req.body;

    if (status === undefined || ![0, 1].includes(Number(status))) {
      return res.status(httpStatus.BAD_REQUEST).json({
        error: true,
        statusCode: httpStatus.BAD_REQUEST,
        message: "Status must be 0 (inactive) or 1 (active).",
      });
    }

    const result = await InstituteService.toggleInstituteStatus(
      req.params.instituteId,
      Number(status),
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── GET CREDENTIALS ──────────────────────────────────────────────────────────
const getInstituteCredentials = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await InstituteService.getInstituteCredentials(
      req.params.instituteId,
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── Get By Slug ──────────────────────────────────────────────────────────────
const getInstituteBySlug = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await InstituteService.getInstituteBySlug(
      req.params.slug,
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

// ─── ADD / UPDATE ADMIN ──────────────────────────────────────────────────────
const addInstituteAdmin = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await InstituteService.addInstituteAdmin(
      req.params.instituteId,
      req.body,
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal Server Error",
    });
  }
};

export default {
  registerInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  softDeleteInstitute,
  toggleInstituteStatus,
  resendAdminCredentials,
  getInstituteCredentials,
  getInstituteBySlug,
  addInstituteAdmin,
};
