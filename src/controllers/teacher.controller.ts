import httpStatus from "http-status";
import { Response } from "express";
import TeacherService from "../services/teacher.service";
import config from "../config/config";
import { sendUserCredentials } from "../utils/mailHelper";

const createTeacher = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.createTeacher(
      req.body,
      req.files,
      req.viaExamUser
    );

    if (!result.error) {
      const slug = req.viaExamUser?.institute?.slug;
      const loginUrl = slug
        ? `${config.frontendUrl}/${slug}/auth/signin`
        : `${config.frontendUrl}/auth/signin`;

      sendUserCredentials({
        userName: `${req.body.firstName} ${req.body.lastName}`,
        email:    req.body.emailId,
        phone:    req.body.phoneNumber,
        password: result.data.plainPassword,
        role:     "Teacher",
        loginUrl,
      }).catch((err) => {
        console.error("Background teacher email dispatch failed:", err);
      });
    }

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getAllTeachers = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.getAllTeachers(req.viaExamUser, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    console.error("getAllTeachers Controller Error:", error);
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getTeacherById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.getTeacherById(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const updateTeacher = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.updateTeacher(
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

const deleteTeacher = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.deleteTeacher(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const assignExaminer = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.assignExaminer(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const removeExaminer = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.removeExaminer(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getDeactivatedTeachers = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.getDeactivatedTeachers(req.viaExamUser, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    console.error("getDeactivatedTeachers Controller Error:", error);
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const reactivateTeacher = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.reactivateTeacher(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    console.error("reactivateTeacher Controller Error:", error);
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getMyAssignments = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.getMyAssignments(req.viaExamUser.userId);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

export default {
  createTeacher,
  getAllTeachers,
  getTeacherById,
  updateTeacher,
  deleteTeacher,
  assignExaminer,
  removeExaminer,
  getDeactivatedTeachers,
  reactivateTeacher,
  getMyAssignments,
};