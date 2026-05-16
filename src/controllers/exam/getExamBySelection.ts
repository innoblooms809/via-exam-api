// controllers/exam.controller.ts

import { Request, Response } from "express";
import httpStatus from "http-status";

import Exam from "../../modals/Exam.modal"

export const getExamBySelection = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const {
      classVal,
      subject,
      examType,
      teacherId
    } = req.body;


    // ─────────────────────────────────────────────
    // Validation
    // ─────────────────────────────────────────────

    if (
      !classVal ||
      !subject ||
      !examType ||
      !teacherId
    ) {
      return res.status(
        httpStatus.BAD_REQUEST
      ).json({
        error: true,

        statusCode:
          httpStatus.BAD_REQUEST,

        message:
          "classVal, subject, examType and teacherId are required",
      });
    }

    // ─────────────────────────────────────────────
    // Find Exam
    // ─────────────────────────────────────────────

    const exam = await Exam.findOne({
      where: {
        classVal,
        subject,
        examType,
        teacherId,
        isDeleted: false,
      },

      attributes: [
        "examId",
        "classVal",
        "subject",
        "examType",
        "session",
      ],
    });

    // ─────────────────────────────────────────────
    // Exam Not Found
    // ─────────────────────────────────────────────

    if (!exam) {
      return res.status(
        httpStatus.NOT_FOUND
      ).json({
        error: true,

        statusCode:
          httpStatus.NOT_FOUND,

        message:
          "No exam found for selected Class, Subject and Exam Type",
      });
    }

    // ─────────────────────────────────────────────
    // Success
    // ─────────────────────────────────────────────

    return res.status(
      httpStatus.OK
    ).json({
      error: false,

      statusCode:
        httpStatus.OK,

      message:
        "Exam fetched successfully.",

      data: exam,
    });

  } catch (e: any) {
    console.error(
      "getExamBySelection Error:",
      e
    );

    return res.status(
      httpStatus.INTERNAL_SERVER_ERROR
    ).json({
      error: true,

      statusCode:
        httpStatus.INTERNAL_SERVER_ERROR,

      message:
        `Something went wrong: ${e.message}`,
    });
  }
};