import { Response } from "express";
import httpStatus from "http-status";
import CrossCheck from "../../services/exam/crossCheck.service";

// /cross-checks — see services/exam/crossCheck.service.

const send = async (res: Response, run: () => Promise<any>, message: string) => {
  try {
    const data = await run();
    return res.status(httpStatus.OK).json({ error: false, message: data?.message ?? message, data });
  } catch (error: any) {
    return res.status(error?.statusCode ?? httpStatus.INTERNAL_SERVER_ERROR).json({ error: true, message: error?.message || "Something went wrong." });
  }
};

const listExams = (req: any, res: Response) => send(res, () => CrossCheck.listExams(req.viaExamUser, req.query), "Cross-checks loaded.");
const examDetail = (req: any, res: Response) => send(res, () => CrossCheck.examDetail(req.viaExamUser, req.params.examId), "Cross-check loaded.");
const startRound = (req: any, res: Response) => send(res, () => CrossCheck.startRound(req.viaExamUser, req.params.examId, req.body ?? {}), "Cross-check started.");
const changeChecker = (req: any, res: Response) => send(res, () => CrossCheck.changeChecker(req.viaExamUser, req.params.examId, req.body ?? {}), "Cross-checker changed.");
const resetRound = (req: any, res: Response) => send(res, () => CrossCheck.resetRound(req.viaExamUser, req.params.examId), "Cross-check started over.");
const myRounds = (req: any, res: Response) => send(res, () => CrossCheck.myRounds(req.viaExamUser, req.query), "Cross-checks loaded.");
const checkItem = (req: any, res: Response) => send(res, () => CrossCheck.checkItem(req.viaExamUser, req.params.itemId, req.body ?? {}), "Saved.");

export default { listExams, examDetail, startRound, changeChecker, resetRound, myRounds, checkItem };
