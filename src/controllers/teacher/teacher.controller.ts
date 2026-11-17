import httpStatus from "http-status";
import { Response } from "express";
import TeacherService from "../../services/teacher/teacher.service";
import config from "../../config/config";
import { queueUserCredentials } from "../../utils/mailHelper";

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

      void queueUserCredentials({
        userName: `${req.body.firstName} ${req.body.lastName}`,
        email:    req.body.emailId,
        phone:    req.body.phoneNumber,
        password: result.data.plainPassword,
        role:     "Teacher",
        loginUrl,
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

const getMyTeaching = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.getMyTeaching(req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getMyStudents = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await TeacherService.getMyStudents(req.viaExamUser, req.query);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getTeacherQuestionPapers = async (req: any, res: Response): Promise<any> => {
  try {
    const targetUserId = req.params?.userId;
    const result = await TeacherService.getTeacherQuestionPapers(
      req.viaExamUser,
      req.query,
      targetUserId
    );
    return res.status(result.statusCode).send(result);
  } catch (error: any) {
    console.error("getTeacherQuestionPapers Controller Error:", error);
    return res.status(500).json({
      error: true,
      statusCode: 500,
      message: `Internal Server Error: ${error.message}`,
    });
  }
};

// PATCH /teacher/specializations/:userId  { specializations: string[] } — school admin only.
const updateSpecializations = async (req: any, res: Response): Promise<any> => {
  try {
    const role = String(req.viaExamUser?.role?.role ?? "").toUpperCase();
    if (!["ADMIN", "SUPER_ADMIN"].includes(role)) {
      return res.status(403).json({ error: true, statusCode: 403, message: "Only the school admin can change specialisations." });
    }
    const result = await TeacherService.updateSpecializations(req.params.userId, req.body, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

export default {
  createTeacher,
  updateSpecializations,
  getAllTeachers,
  updateTeacher,
  deleteTeacher,
  getDeactivatedTeachers,
  reactivateTeacher,
  getMyTeaching,
  getMyStudents,
  getTeacherQuestionPapers,
};
