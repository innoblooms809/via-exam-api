import httpStatus from "http-status";
import { Response } from "express";
import MarksService from "../../services/academic/marks.service";
import SettingsService from "../../services/academic/instituteSettings.service";
import TemplateService from "../../services/academic/reportTemplate.service";

// Marks & grading (Master Data): subject marks per exam and session, grade bands, the marks
// a subject starts with, cross-checking rules, and the log of every marks change.

const send = (res: Response, run: () => Promise<any>) =>
  run()
    .then((result) => res.status(result.statusCode).send(result))
    .catch(() => res.status(httpStatus.INTERNAL_SERVER_ERROR).json({ error: true, statusCode: httpStatus.INTERNAL_SERVER_ERROR, message: "Internal Server Error" }));

const getMarks = (req: any, res: Response) => send(res, () => MarksService.getMarks(req.viaExamUser, req.query));
const saveMarks = (req: any, res: Response) => send(res, () => MarksService.saveMarks(req.viaExamUser, req.body ?? {}));
const copyMarks = (req: any, res: Response) => send(res, () => MarksService.copyMarks(req.viaExamUser, req.body ?? {}));
const getChanges = (req: any, res: Response) => send(res, () => MarksService.getChanges(req.viaExamUser, req.query));

const getSettings = (req: any, res: Response) => send(res, () => SettingsService.getSettings(req.viaExamUser));
const saveGradingScale = (req: any, res: Response) => send(res, () => SettingsService.saveGradingScale(req.viaExamUser, req.body ?? {}));
const saveMarksDefaults = (req: any, res: Response) => send(res, () => SettingsService.saveMarksDefaults(req.viaExamUser, req.body ?? {}));
const saveCrossCheck = (req: any, res: Response) => send(res, () => SettingsService.saveCrossCheck(req.viaExamUser, req.body ?? {}));
const getResultSheet = (req: any, res: Response) => send(res, () => TemplateService.getResultSheet(req.viaExamUser));
const saveResultSheet = (req: any, res: Response) => send(res, () => TemplateService.saveResultSheet(req.viaExamUser, req.body ?? {}));
const resetResultSheet = (req: any, res: Response) => send(res, () => TemplateService.resetResultSheet(req.viaExamUser));

export default { getMarks, saveMarks, copyMarks, getChanges, getSettings, saveGradingScale, saveMarksDefaults, saveCrossCheck, getResultSheet, saveResultSheet, resetResultSheet };
