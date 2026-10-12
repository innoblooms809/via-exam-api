import { Response } from "express";
import httpStatus from "http-status";
import ExamWorkflowService from "../../services/exam/examWorkflow.service";
import logger from "../../config/logger";
import { logActivity } from "../../utils/activityLogger";

const send = (res: Response, message: string, data: unknown, statusCode: number = httpStatus.OK) =>
  res.status(statusCode).json({ error: false, statusCode, message, data });

const fail = (res: Response, err: any) => {
  const statusCode = err?.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
  if (statusCode >= 500) logger.error(`[ExamWorkflow] ${err?.stack || err?.message || err}`);
  return res.status(statusCode).json({
    error: true,
    statusCode,
    // Internal errors never leak SQL or stack details to the browser.
    message: statusCode >= 500 ? "Something went wrong. Please try again." : err?.message,
  });
};

type Audit = { event: string; entity: "EXAM" | "RECHECK"; param: "examId" | "requestId" };

const handle =
  (message: string, run: (req: any) => Promise<unknown>, statusCode: number = httpStatus.OK, audit?: Audit) =>
  async (req: any, res: Response) => {
    try {
      const data = await run(req);
      // Every step of the workflow lands in the activity log (never blocks the reply).
      if (audit) {
        const u = req.viaExamUser;
        void logActivity({
          userId: u?.userId,
          role: u?.role?.role ?? "",
          instituteId: u?.instituteId ?? null,
          eventType: audit.event,
          entityType: audit.entity,
          entityId: String(req.params?.[audit.param] ?? ""),
          metadata: { body: req.body },
          req,
        });
      }
      return send(res, message, data, statusCode);
    } catch (err) {
      return fail(res, err);
    }
  };

const exam = (event: string): Audit => ({ event, entity: "EXAM", param: "examId" });
const recheck = (event: string): Audit => ({ event, entity: "RECHECK", param: "requestId" });

const user = (req: any) => req.viaExamUser;

export default {
  // Admin — pipeline
  listPipeline: handle("Exams fetched.", (req) => ExamWorkflowService.listPipeline(user(req), req.query)),
  getTimeline: handle("Timeline fetched.", (req) => ExamWorkflowService.getTimeline(user(req), req.params.examId)),

  // Admin — scanner assignment
  listScanners: handle("Scanners fetched.", (req) => ExamWorkflowService.listScanners(user(req), req.params.examId)),
  assignScanner: handle("Scanner assigned.", (req) => ExamWorkflowService.assignScanner(user(req), req.params.examId, req.body), httpStatus.OK, exam("SCANNER_ASSIGNED")),
  unassignScanner: handle("Scanner unassigned.", (req) => ExamWorkflowService.unassignScanner(user(req), req.params.examId), httpStatus.OK, exam("SCANNER_UNASSIGNED")),

  // Scanner
  myScanExams: handle("Assigned exams fetched.", (req) => ExamWorkflowService.myScanExams(user(req), req.query)),
  scanRoster: handle("Roster fetched.", (req) => ExamWorkflowService.scanRoster(user(req), req.params.examId)),
  setAttendance: handle("Attendance saved.", (req) => ExamWorkflowService.setAttendance(user(req), req.params.examId, req.body), httpStatus.OK, exam("ATTENDANCE_MARKED")),
  completeScan: handle("Upload marked complete.", (req) => ExamWorkflowService.completeScan(user(req), req.params.examId), httpStatus.OK, exam("SCAN_COMPLETED")),

  // Admin — results
  publishResults: handle("Results published.", (req) => ExamWorkflowService.publishResults(user(req), req.params.examId), httpStatus.OK, exam("RESULTS_PUBLISHED")),
  unpublishResults: handle("Results withdrawn.", (req) => ExamWorkflowService.unpublishResults(user(req), req.params.examId), httpStatus.OK, exam("RESULTS_UNPUBLISHED")),
  listResults: handle("Results fetched.", (req) => ExamWorkflowService.listResults(user(req), req.query)),

  // Student
  myResults: handle("Results fetched.", (req) => ExamWorkflowService.myResults(user(req), req.query)),
  createRecheck: handle("Recheck requested.", (req) => ExamWorkflowService.createRecheck(user(req), req.body), httpStatus.CREATED),

  // Rechecks — admin / teacher
  listRechecks: handle("Recheck requests fetched.", (req) => ExamWorkflowService.listRechecks(user(req), req.query)),
  assignRecheck: handle("Recheck assigned.", (req) => ExamWorkflowService.assignRecheck(user(req), req.params.requestId, req.body), httpStatus.OK, recheck("RECHECK_ASSIGNED")),
  rejectRecheck: handle("Recheck rejected.", (req) => ExamWorkflowService.rejectRecheck(user(req), req.params.requestId, req.body), httpStatus.OK, recheck("RECHECK_REJECTED")),
  myRechecks: handle("Recheck requests fetched.", (req) => ExamWorkflowService.myRechecks(user(req), req.query)),
  completeRecheck: handle("Recheck completed.", (req) => ExamWorkflowService.completeRecheck(user(req), req.params.requestId, req.body), httpStatus.OK, recheck("RECHECK_COMPLETED")),
};
