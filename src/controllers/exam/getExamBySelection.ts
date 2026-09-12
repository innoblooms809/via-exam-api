// controllers/exam.controller.ts

import { Request, Response } from "express";
import httpStatus from "http-status";

import Exam from "../../modals/Exam.modal"
import Subject from "../../modals/Subject.modal"
import Class from "../../modals/Class.modal"
import Session from "../../modals/Session.modal"
import Institute from "../../modals/Institute.modal"


  export const getExamBySelection = async (
  req: any,
  res: Response
): Promise<any> => {
  try {
    const {
      classVal,
      subject,
      examType,
      session,
    } = req.body;

    const instituteId = req.viaExamUser?.instituteId || req.body.instituteId;

    // ─────────────────────────────────────────────
    // Find Session + Class Together
    // ─────────────────────────────────────────────

    const [sessionData, classData] =
      await Promise.all([

        Session.findOne({
          where: {
            sessionName: session,
            instituteId,
            isDeleted: false,
          },
        }),

        Class.findOne({
          where: {
            className: classVal,
            instituteId,
            isDeleted: false,
          },
        }),
      ]);

    // ─────────────────────────────────────────────
    // Session Check
    // ─────────────────────────────────────────────

    if (!sessionData) {
      return res.status(
        httpStatus.NOT_FOUND
      ).json({
        error: true,

        statusCode:
          httpStatus.NOT_FOUND,

        message:
          "Session not found.",
      });
    }

    // ─────────────────────────────────────────────
    // Class Check
    // ─────────────────────────────────────────────

    if (!classData) {
      return res.status(
        httpStatus.NOT_FOUND
      ).json({
        error: true,

        statusCode:
          httpStatus.NOT_FOUND,

        message:
          "Class not found.",
      });
    }

    // ─────────────────────────────────────────────
    // Find Subject
    // ─────────────────────────────────────────────

    const subjectData =
      await Subject.findOne({
        where: {
          subjectName: subject,
          classId: classData.classId,
          instituteId,
          isDeleted: false,
        },
      });

    if (!subjectData) {
      return res.status(
        httpStatus.NOT_FOUND
      ).json({
        error: true,

        statusCode:
          httpStatus.NOT_FOUND,

        message:
          "Subject not found.",
      });
    }

    // ─────────────────────────────────────────────
    // Find Exam
    // ─────────────────────────────────────────────

    const exam = await Exam.findOne({
      where: {
        sessionId:
          sessionData.sessionId,

        classId:
          classData.classId,

        subjectId:
          subjectData.subjectId,

        examType,

      

        instituteId,

        isDeleted: false,
      },
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
    // Fetch Institute Details for auto-fill
    // ─────────────────────────────────────────────
    
    const institute = await Institute.findOne({
      where: {
        instituteId: exam.instituteId,
        isDeleted: false,
      },
    });

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

      data: {
        ...exam.toJSON(),
        institute: institute ? {
          instituteId: institute.instituteId,
          instituteName: institute.instituteName,
          logoUrl: institute.logoUrl,
          slug: institute.slug,
        } : null,
      },
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