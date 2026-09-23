import httpStatus from "http-status";
import { Response } from "express";
import StudentService from "../services/student.service";
import { getTeacherScope, isTeacherRequester, maskStudentRecord } from "../services/evaluationAccess.service";
import config from "../config/config";
import { sendUserCredentials } from "../utils/mailHelper";

const createStudent = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.createStudent(
      req.body, req.files, req.viaExamUser
    );
  

    if (!result.error) {
      const slug = req.viaExamUser?.institute?.slug;
      const loginUrl = slug
        ? `${config.frontendUrl}/${slug}/auth/signin`
        : `${config.frontendUrl}/auth/signin`;

      sendUserCredentials({
        userName: `${req.body.firstName} ${req.body.lastName}`,
        email:    req.body.email,
        phone:    req.body.mobile,
        password: result.data.plainPassword,
        role:     "Student",
        loginUrl,
      }).catch((err) => {
        console.error("Background student email dispatch failed:", err);
      });
    }

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getAllStudents = async (req: any, res: Response): Promise<any> => {
  try {
    console.log("GET /v1/student/getAllStudents - query:", req.query, "user:", req.viaExamUser?.id);
    const result = await StudentService.getAllStudents(req.viaExamUser, req.query);
    // Teachers see real student details only for classes they teach; for any other
    // class (e.g. one they only evaluate) the identity is masked.
    if (!result.error && isTeacherRequester(req.viaExamUser) && Array.isArray(result.data?.students)) {
      const scope = await getTeacherScope(req.viaExamUser);
      result.data.students = result.data.students.map((s: any) =>
        scope.ownClassKeys.has(String(s.className ?? "")) ? s : maskStudentRecord(s)
      );
    }
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getStudentById = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.getStudentById(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const updateStudent = async (req: any, res: Response): Promise<any> => {
  try {
    console.log("PUT /v1/student/updateStudent -", "params:", req.params, "body:", req.body, "user:", req.viaExamUser?.id);
    const result = await StudentService.updateStudent(
      req.params.userId, req.body, req.files, req.viaExamUser
    );
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const deleteStudent = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.deleteStudent(req.params.userId, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const bulkCreateStudents = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.bulkCreateStudents(
      req.body?.students,
      req.viaExamUser,
    );

    // Mirror the single-student flow: every student that was actually created
    // gets their login details by email. Dispatched in the background and one
    // at a time so a 500-row upload cannot stall the response or flood SMTP.
    const created: any[] = !result.error ? (result.data?.successes ?? []) : [];
    if (created.length > 0) {
      const slug = req.viaExamUser?.institute?.slug;
      const loginUrl = slug
        ? `${config.frontendUrl}/${slug}/auth/signin`
        : `${config.frontendUrl}/auth/signin`;

      void (async () => {
        for (const student of created) {
          if (!student.generatedPassword) continue; // admin set the password themselves
          try {
            await sendUserCredentials({
              userName: student.name,
              email: student.email,
              phone: student.mobile,
              password: student.generatedPassword,
              role: "Student",
              loginUrl,
            });
          } catch (err) {
            console.error(
              `Background bulk student email dispatch failed for ${student.email}:`,
              err,
            );
          }
        }
      })();
    }

    return res.status(result.statusCode).send(result);
  } catch (error) {
    console.error("bulkCreateStudents controller error:", error);
    return res
      .status(500)
      .json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

export default {
  createStudent,
  getAllStudents,
  getStudentById,
  updateStudent,
  deleteStudent,
  bulkCreateStudents,
};