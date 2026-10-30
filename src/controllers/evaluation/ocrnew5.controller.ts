import { Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import { evaluateSheetOCRNew5 } from "../../services/evaluation/ocrnew5.service";
import Pipeline6Service from "../../services/evaluation/pipeline6.service";

const evaluateSheetOCRNew5Controller = catchAsync(async (req: any, res: Response): Promise<any> => {
  const { sheetId } = req.body;
  if (!sheetId) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: "error",
      message: "sheetId is required in request body",
    });
  }

  // A recheck run (published results) goes into the recheck's draft, which only pipeline 6 writes.
  if (req.recheck || req.crossCheck) {
    const queued = await Pipeline6Service.triggerPipeline6Evaluation(sheetId, true, req.recheck ?? null, req.crossCheck ?? null);
    return res.status(queued.statusCode).send(queued);
  }
  const result = await evaluateSheetOCRNew5(sheetId);
  return res.status(httpStatus.OK).json({
    status: "success",
    message: "ocrnew5 multi-agent evaluation complete.",
    data: result,
  });
});

export default {
  evaluateSheetOCRNew5: evaluateSheetOCRNew5Controller,
};
