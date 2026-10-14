import { Request, Response } from "express";
import httpStatus from "http-status";
import HomeService from "../../services/dashboard/home.service";
import PersonService from "../../services/dashboard/person.service";

type Result = { statusCode: number; error: boolean };

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
  getPerson: (req: Request, res: Response) => run((user) => PersonService.getPerson(user, String(req.params.userId ?? "")), 0)(req, res),
};
