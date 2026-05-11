import httpStatus from "http-status";
import { Response } from "express";
import InstituteService from "../services/institute.service";
import { sendAdminCredentials, sendEmailToNewUser } from "../utils/mailHelper";

const registerInstitute = async (req: any, res: Response): Promise<any> => {
  try {
    // req.files comes from multer
    const result = await InstituteService.registerInstitute(
      req.body,
      req.files,
    );

    // Send welcome email to admin if created successfully
    if (!result.error) {
      await sendAdminCredentials({
        adminName: `${req.body.adminFirstName} ${req.body.adminLastName}`,
        adminEmail: req.body.adminEmail,
        adminPassword: req.body.adminPassword,
        instituteName: req.body.instituteName,
        loginUrl: result.data.loginUrl,
        plan: req.body.plan,
      });
    }

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
    const result = await InstituteService.getAllInstitutes(req.query);
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
    const result = await InstituteService.updateInstitute(
      req.params.instituteId,
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

export default {
  registerInstitute,
  getAllInstitutes,
  getInstituteById,
  updateInstitute,
  softDeleteInstitute,
  toggleInstituteStatus,
};
