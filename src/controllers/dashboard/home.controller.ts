import { Request, Response } from "express";
import httpStatus from "http-status";
import HomeService from "../../services/dashboard/home.service";
import PersonService from "../../services/dashboard/person.service";

type Result = { statusCode: number; error: boolean };

/** A single query-string value, or null. */
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

// Per-user data behind auth: the browser may reuse a response briefly, never a shared cache.
const run =
  (handler: (user: any) => Promise<Result>, maxAgeSeconds = 10) =>
  async (req: Request, res: Response): Promise<any> => {
    try {
      const result = await handler((req as any).viaExamUser);
      if (!result.error) res.set("Cache-Control", `private, max-age=${maxAgeSeconds}`);
      return res.status(result.statusCode).send(result);
    } catch {
      return res.status(httpStatus.INTERNAL_SERVER_ERROR).json({
        error: true,
        statusCode: httpStatus.INTERNAL_SERVER_ERROR,
        message: "Internal Server Error",
      });
    }
  };

export default {
  getAdminHome: run(HomeService.getAdminHome),
  getSetupStatus: run(HomeService.getSetupStatus, 0),
  getTeacherHome: run(HomeService.getTeacherHome),
  getScannerHome: run(HomeService.getScannerHome),
  getStudentHome: run(HomeService.getStudentHome),
  getPerson: (req: Request, res: Response) =>
    run((user) => PersonService.getPerson(user, String(req.params.userId ?? ""), { sessionId: str(req.query.sessionId), examType: str(req.query.examType) }), 0)(req, res),
  getPersonWork: (req: Request, res: Response) =>
    run(
      (user) =>
        PersonService.getPersonWork(user, String(req.params.userId ?? ""), {
          status: str(req.query.status),
          group: str(req.query.group),
          sessionId: str(req.query.sessionId), examType: str(req.query.examType),
          cursor: str(req.query.cursor),
          limit: req.query.limit,
        }),
      0,
    )(req, res),
  getPersonHistory: (req: Request, res: Response) =>
    run(
      (user) =>
        PersonService.getPersonHistory(user, String(req.params.userId ?? ""), {
          sessionId: str(req.query.sessionId), examType: str(req.query.examType),
          kind: str(req.query.kind),
          cursor: str(req.query.cursor),
          limit: req.query.limit,
        }),
      0,
    )(req, res),
};
