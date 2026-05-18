
// ======================================================
// CONTROLLER
// src/controllers/questionPaperAnswer.controller.ts
// ======================================================

import { Request, Response } from "express";

import QuestionPaperAnswerService from "../../services/question-answer/stander-answer.service";

export const createQuestionPaperAnswer = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const {
   
      instituteId,
      paperId,
      examId,
      teacherId,
      paperSet,
      answers,
      status,
    } = req.body;

    // BASIC VALIDATION
    if (
   
      !instituteId ||
      !paperId ||
      !examId ||
      !teacherId ||
      !paperSet ||
      !answers
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    const result =
      await QuestionPaperAnswerService.createQuestionPaperAnswer(
        {
       
          instituteId,
          paperId,
          examId,
          teacherId,
          paperSet,
          answers,
          status,
        }
      );

    return res.status(201).json({
      success: true,
      message: "Question paper answer created successfully",
      data: result,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



export const uploadImageController = async (
  req: Request,
  res: Response
): Promise<any> => {
  try {
    const files = req.files as {
      [fieldname: string]: Express.Multer.File[];
    };

    const toUploadUrl = (file: Express.Multer.File) =>
      `/${file.path.replace(/\\/g, "/").replace(/^uploads\//, "uploads/")}`;

    const diagramFiles = [
      ...(files?.diagram || []),
      ...(files?.diagramUrls || []),
    ];

    const diagramUrls = diagramFiles.map(toUploadUrl);

    return res.status(200).json({
      error: false,
      message: "Images uploaded successfully",
      data: {
        diagramUrls,
      },
    });

  } catch (e: any) {
    return res.status(500).json({
      error: true,
      message: e.message,
    });
  }
};

