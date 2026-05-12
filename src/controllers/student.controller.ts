import httpStatus from "http-status";
import { Response } from "express";
import StudentService from "../services/student.service";
import { sendEmailToNewUser } from "../utils/mailHelper";

const createStudent = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.createStudent(
      req.body, req.files, req.viaExamUser
    );

    if (!result.error) {
      await sendEmailToNewUser({
        emailId:     req.body.email,
        phoneNumber: req.body.mobile,
        userName:    `${req.body.firstName} ${req.body.lastName}`,
        password:    result.data.plainPassword,
      });
    }

    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
  }
};

const getAllStudents = async (req: any, res: Response): Promise<any> => {
  try {
    const result = await StudentService.getAllStudents(req.viaExamUser, req.query);
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
    const result = await StudentService.bulkCreateStudents(req.body.students, req.viaExamUser);
    return res.status(result.statusCode).send(result);
  } catch (error) {
    return res.status(500).json({ error: true, statusCode: 500, message: "Internal Server Error" });
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