import { Response } from "express";
import httpStatus from "http-status";
import ReopenService from "../../services/evaluation/evaluationReopen.service";
import { msg } from "../../i18n/message";

const send = (res: Response, message: unknown, data: unknown, statusCode: number = httpStatus.OK) =>
  res.status(statusCode).json({ error: false, statusCode, message, data });

/** A refusal in the request's language, with its details (`data.needsConfirm` asks the admin to confirm). */
const fail = (res: Response, err: any) => {
  const statusCode = err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
  return res.status(statusCode).json({
    error: true,
    statusCode,
    message: statusCode === httpStatus.INTERNAL_SERVER_ERROR ? msg("Something went wrong. Try again.") : err?.localized ?? err?.message,
    ...(err?.data ? { data: err.data } : {}),
  });
};

// POST /v1/evaluation-assignments/exams/:examId/reopen-request — the evaluator asks.
const requestReopen = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, msg("Request sent. The admin has been told."), await ReopenService.requestReopen(req.viaExamUser, req.params.examId, req.body), httpStatus.CREATED);
  } catch (err) {
    return fail(res, err);
  }
};

// GET /v1/evaluation-assignments/reopen-requests — the admin's list.
const listReopenRequests = async (req: any, res: Response): Promise<any> => {
  try {
    res.setHeader("Cache-Control", "no-store");
    return send(res, msg("Reopen requests."), await ReopenService.listReopenRequests(req.viaExamUser, req.query));
  } catch (err) {
    return fail(res, err);
  }
};

// POST /v1/evaluation-assignments/reopen-requests/:requestId/approve
const approveReopen = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, msg("Marks reopened. The evaluator has been told."), await ReopenService.approveReopen(req.viaExamUser, req.params.requestId, req.body));
  } catch (err) {
    return fail(res, err);
  }
};

// POST /v1/evaluation-assignments/reopen-requests/:requestId/reject
const rejectReopen = async (req: any, res: Response): Promise<any> => {
  try {
    return send(res, msg("Request declined. The evaluator has been told why."), await ReopenService.rejectReopen(req.viaExamUser, req.params.requestId, req.body));
  } catch (err) {
    return fail(res, err);
  }
};

export default { requestReopen, listReopenRequests, approveReopen, rejectReopen };
