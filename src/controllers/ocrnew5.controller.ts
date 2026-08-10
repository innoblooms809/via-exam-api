import { Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../utils/catchAsync";
import { evaluateSheetOCRNew5 } from "../services/ocrnew5.service";

const evaluateSheetOCRNew5Controller = catchAsync(async (req: any, res: Response): Promise<any> => {
  const { sheetId } = req.body;
  if (!sheetId) {
    return res.status(httpStatus.BAD_REQUEST).json({
      status: "error",
      message: "sheetId is required in request body",
    });
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
