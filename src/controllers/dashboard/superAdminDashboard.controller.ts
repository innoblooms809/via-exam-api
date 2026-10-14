import { Request, Response } from "express";
import httpStatus from "http-status";
import SuperAdminDashboardService from "../../services/dashboard/superAdminDashboard.service";
import SuperAdminReportsService from "../../services/dashboard/superAdminReports.service";

type Result = { statusCode: number; error: boolean };

// The numbers are aggregated server-side and cached for a minute; let the browser
// reuse a response briefly too (private: it is per-user data behind auth).
const send = (res: Response, result: Result, maxAgeSeconds = 30) => {
  if (!result.error) res.set("Cache-Control", `private, max-age=${maxAgeSeconds}`);
  return res.status(result.statusCode).send(result);
};

const run =
  (handler: (req: Request) => Promise<Result>, maxAgeSeconds?: number) =>
  async (req: Request, res: Response): Promise<any> => {
    try {
      return send(res, await handler(req), maxAgeSeconds);
    } catch {
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "Internal Server Error",
      });
    }
  };

export default {
  getSummary: run(() => SuperAdminDashboardService.getSummary()),
  getTrends: run((req) => SuperAdminDashboardService.getTrends(req.query as any)),
  getInstitutes: run((req) => SuperAdminDashboardService.getInstitutes(req.query as any)),
  getRenewals: run((req) => SuperAdminDashboardService.getRenewals(req.query as any)),
  getLive: run(() => SuperAdminDashboardService.getLive(), 15),

  // Detail reports (paged lists behind each dashboard card)
  getInstitutesReport: run((req) => SuperAdminReportsService.listInstitutes(req.query as any), 15),
  getActivityReport: run((req) => SuperAdminReportsService.listActivity(req.query as any), 15),
  getRevenueReport: run((req) => SuperAdminReportsService.getRevenue(req.query as any), 15),
  getEvaluationsReport: run((req) => SuperAdminReportsService.listEvaluations(req.query as any), 10),
  getAnswerSheetsReport: run((req) => SuperAdminReportsService.listAnswerSheets(req.query as any), 10),
  getExamsReport: run((req) => SuperAdminReportsService.listExams(req.query as any), 15),
  getPlatform: run(() => SuperAdminReportsService.getPlatform(), 0),
};
