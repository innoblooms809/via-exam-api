import { Response } from "express";
import httpStatus from "http-status";
import EvaluationAssignmentService from "../services/evaluationAssignment.service";

const send = (res: Response, message: string, data: unknown, statusCode: number = httpStatus.OK) =>
  res.status(statusCode).json({ error: false, statusCode, message, data });

const fail = (res: Response, err: any) => {
  const statusCode = err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
  return res.status(statusCode).json({
    error: true,
    statusCode,
    message: statusCode === httpStatus.INTERNAL_SERVER_ERROR ? `Something went wrong: ${err?.message}` : err?.message,
  });
};

// GET /v1/evaluation-assignments/exams
const listExams = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, "Exams fetched.", await EvaluationAssignmentService.listExams(req.viaExamUser, req.query));
  } catch (err) {
    return fail(res, err);
  }
};

// GET /v1/evaluation-assignments/exams/:examId/teachers
const listEligibleTeachers = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, "Teachers fetched.", await EvaluationAssignmentService.listEligibleTeachers(req.viaExamUser, req.params.examId));
  } catch (err) {
    return fail(res, err);
  }
};

// POST /v1/evaluation-assignments   { examId, teacherId, note? }
const assign = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, "Evaluator assigned.", await EvaluationAssignmentService.assign(req.viaExamUser, req.body));
  } catch (err) {
    return fail(res, err);
  }
};

// DELETE /v1/evaluation-assignments/exams/:examId
const unassign = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, "Evaluator removed.", await EvaluationAssignmentService.unassign(req.viaExamUser, req.params.examId));
  } catch (err) {
    return fail(res, err);
  }
};

// GET /v1/evaluation-assignments/roster?className=&section=&session=&examType=&classId=&subjectId=|subjectName=&examId=
const getRoster = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, "Roster fetched.", await EvaluationAssignmentService.getRoster(req.viaExamUser, req.query));
  } catch (err) {
    return fail(res, err);
  }
};

// GET /v1/evaluation-assignments/my-exams
const myExams = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, "Exams fetched.", await EvaluationAssignmentService.myExams(req.viaExamUser));
  } catch (err) {
    return fail(res, err);
  }
};

export default { listExams, listEligibleTeachers, assign, unassign, getRoster, myExams };
