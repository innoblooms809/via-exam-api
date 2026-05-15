import { Response } from "express";
import SubjectService from "../services/subject.service";

const createSubject = async (req: any, res: Response): Promise<any> => {
  try {

    const result = await SubjectService.createSubject(
      req.body,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error) {

    return res.status(500).json({
      error: true,
      statusCode: 500,
      message: "Internal Server Error",
    });

  }
};

const getAllSubjects = async (req: any, res: Response): Promise<any> => {
  try {

    const result = await SubjectService.getAllSubjects(
      req.query,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error) {

    return res.status(500).json({
      error: true,
      statusCode: 500,
      message: "Internal Server Error",
    });

  }
};

const getSubjectById = async (req: any, res: Response): Promise<any> => {
  try {

    const result = await SubjectService.getSubjectById(
      req.params.subjectId,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error) {

    return res.status(500).json({
      error: true,
      statusCode: 500,
      message: "Internal Server Error",
    });

  }
};

const updateSubject = async (req: any, res: Response): Promise<any> => {
  try {

    const result = await SubjectService.updateSubject(
      req.params.subjectId,
      req.body,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error) {

    return res.status(500).json({
      error: true,
      statusCode: 500,
      message: "Internal Server Error",
    });

  }
};

const deleteSubject = async (req: any, res: Response): Promise<any> => {
  try {

    const result = await SubjectService.deleteSubject(
      req.params.subjectId,
      req.viaExamUser
    );

    return res.status(result.statusCode).send(result);

  } catch (error) {

    return res.status(500).json({
      error: true,
      statusCode: 500,
      message: "Internal Server Error",
    });

  }
};

export default {
  createSubject,
  getAllSubjects,
  getSubjectById,
  updateSubject,
  deleteSubject,
};