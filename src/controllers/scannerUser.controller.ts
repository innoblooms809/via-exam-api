import httpStatus from "http-status";
import { Response } from "express";
import ScannerUserService from "../services/scannerUser.service";
import config from "../config/config";
import { sendUserCredentials } from "../utils/mailHelper";

const createScanner = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ScannerUserService.createScanner(
      req.body,
      req.files,
      req.viaExamUser
    );

    if (!result.error) {
      const slug = result.data?.instituteSlug || req.viaExamUser?.institute?.slug;
      const loginUrl = slug
        ? `${config.frontendUrl}/${slug}/auth/signin`
        : `${config.frontendUrl}/auth/signin`;

      const recipientEmail = req.body.emailId || req.body.email;
      const recipientPhone = req.body.phoneNumber || req.body.mobile || req.body.phone;

      if (recipientEmail) {
        sendUserCredentials({
          userName: `${req.body.firstName} ${req.body.lastName}`,
          email:    recipientEmail,
          phone:    recipientPhone || "",
          password: result.data.plainPassword,
          role:     "Scanner",
          loginUrl,
        }).catch((err) => {
          console.error("Background scanner email dispatch failed:", err);
        });
      } else {
        console.warn("Scanner user created without an email address — skipping credentials email.");
      }
    }

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getAllScanners = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ScannerUserService.getAllScanners(req.viaExamUser, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getScannerById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ScannerUserService.getScannerById(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const updateScanner = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ScannerUserService.updateScanner(
      req.params.userId,
      req.body,
      req.files,
      req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const deleteScanner = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ScannerUserService.deleteScanner(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const reactivateScanner = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await ScannerUserService.reactivateScanner(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    console.error("reactivateScanner Controller Error:", error);
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

export default {
  createScanner,
  getAllScanners,
  getScannerById,
  updateScanner,
  deleteScanner,
  reactivateScanner,
};
