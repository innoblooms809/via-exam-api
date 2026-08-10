import httpStatus from "http-status";
import Scanner from "../modals/Scanner.modal";
import Exam from "../modals/Exam.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import ApiError from "../utils/ApiError";
import RegHelper from "../utils/helper";
import logger from "../config/logger";
import axios from "axios";

// Helper to format question paper content into text
const formatQuestionPaper = (content: any, ansDoc?: any): { questions: string; answers: string } => {
  let questions = "";
  let answers = "";

  if (!content) return { questions, answers };

  const answerMap: Record<string, any> = {};
  if (ansDoc) {
    let ansData = ansDoc;
    if (typeof ansData === "string") {
      try { ansData = JSON.parse(ansData); } catch { }
    }
    if (Array.isArray(ansData)) {
      ansData.forEach((a: any) => {
        const id = a.questionId || a.id || a.key;
        if (id) answerMap[id] = a;
      });
    } else if (ansData && typeof ansData === "object") {
      Object.keys(ansData).forEach((key) => {
        const a = ansData[key];
        const id = a.questionId || a.id || a.key || key;
        answerMap[id] = a;
      });
    }
  }

  if (content.title) {
    questions += `Title: ${content.title}\n`;
  }

  let foundQuestions = false;

  if (Array.isArray(content.sections) && content.sections.length > 0) {
    for (const section of content.sections) {
      const secName = section.name || section.title || "";
      if (!secName && (!section.questions || section.questions.length === 0)) continue;

      questions += `\n--- Section: ${secName} ---\n`;
      if (section.instructions) {
        questions += `Instructions: ${section.instructions}\n`;
      }
      if (Array.isArray(section.questions)) {
        for (const q of section.questions) {
          foundQuestions = true;
          const qId = q.questionId || q.id || q.key || "";
          const qText = q.text || q.question || "";
          const qMarks = q.marks !== undefined ? q.marks : "";
          questions += `${qId}. ${qText} ${qMarks ? `[Marks: ${qMarks}]` : ""}\n`;

          const expectedAns = answerMap[qId]?.answer || q.answer;
          if (expectedAns) {
            answers += `${qId}. Expected Answer: ${expectedAns}\n`;
          }
        }
      }
    }
  }

  if (Array.isArray(content.questions) && content.questions.length > 0) {
    questions += `\n--- Questions ---\n`;
    for (const q of content.questions) {
      foundQuestions = true;
      const qId = q.questionId || q.id || q.key || "";
      const qText = q.text || q.question || "";
      const qMarks = q.marks !== undefined ? q.marks : "";
      questions += `${qId}. ${qText} ${qMarks ? `[Marks: ${qMarks}]` : ""}\n`;

      const expectedAns = answerMap[qId]?.answer || q.answer;
      if (expectedAns) {
        answers += `${qId}. Expected Answer: ${expectedAns}\n`;
      }
    }
  }

  if (!foundQuestions && typeof content === "object") {
    questions = JSON.stringify(content, null, 2);
  }

  return { questions, answers };
};

export const evaluateSheetOCRNew5 = async (sheetId: string) => {
  logger.info(`[OCRNew5 Service] Initiating AI evaluation for sheet: ${sheetId}`);

  // 1. Fetch Scanner Sheet
  const sheet: any = (await Scanner.findOne({ where: { sheetId, isDeleted: false } })) || (await Scanner.findByPk(sheetId));
  if (!sheet) {
    throw new ApiError(httpStatus.NOT_FOUND, "Scanner sheet not found.");
  }

  // 2. Perform OCR on Student Answer Sheet if image/buffer available
  let studentAnsText = sheet.ocrText || sheet.answerText || "";
  if (!studentAnsText && sheet.fileBuffer && sheet.fileBuffer.length > 0) {
    try {
      const ocrApiUrl = process.env.OCR_API_URL || "http://localhost:8000/ocrOutput";
      let fileName = sheet.fileName || "sheet.png";
      if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
        const ext = sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
        fileName = `${fileName}${ext}`;
      }

      const ocrFormData = new FormData();
      const fileBlob = new Blob([sheet.fileBuffer], { type: sheet.fileMimeType || "image/png" });
      ocrFormData.append("file", fileBlob, fileName);

      logger.info(`[OCRNew5 Service] Performing OCR on sheet image (${fileName})...`);
      const ocrRes = await axios.post(ocrApiUrl, ocrFormData, { timeout: 3600000 });
      if (ocrRes.data && ocrRes.data.combined_markdown) {
        studentAnsText = ocrRes.data.combined_markdown;
        logger.info(`[OCRNew5 Service] OCR successful (${studentAnsText.length} characters extracted).`);
      }
    } catch (ocrErr: any) {
      logger.error("[OCRNew5 Service] OCR step failed:", ocrErr.message);
    }
  }

  // 3. Resolve Student, Question Paper, Answer Key
  const student = await StudentProfile.findOne({
    where: { rollNumber: sheet.rollNo, instituteId: sheet.instituteId, classId: sheet.classId },
  });
  const studentId = student ? student.userId : (sheet.studentId || `STUDENT-${sheet.rollNo}`);
  let examId = sheet.examType;
  let maxMarks = 10;
  let questionText = "Evaluate student answer sheet.";
  let answerKeyText = "";

  const exam = await Exam.findOne({
    where: { instituteId: sheet.instituteId, classId: sheet.classId, subjectId: sheet.subjectId, examType: sheet.examType, isDeleted: false },
    order: [["createdAt", "DESC"]],
  });

  if (exam) {
    examId = exam.examId;
    maxMarks = exam.totalMarks || 10;
    const targetPaperSet = sheet.section || "A";

    let questionPaper = await QuestionPaper.findOne({
      where: { examId: exam.examId, instituteId: sheet.instituteId, paperSet: targetPaperSet },
      order: [["createdAt", "DESC"]],
    }) || await QuestionPaper.findOne({
      where: { examId: exam.examId, instituteId: sheet.instituteId },
      order: [["createdAt", "DESC"]],
    });

    if (questionPaper) {
      let qpAnswer = await QuestionPaperAnswer.findOne({
        where: { paperId: questionPaper.paperId, paperSet: questionPaper.paperSet },
      }) || await QuestionPaperAnswer.findOne({
        where: { paperId: questionPaper.paperId },
      });

      const { questions, answers } = formatQuestionPaper(questionPaper.content, qpAnswer ? qpAnswer.answers : null);
      if (questions) questionText = questions;
      if (answers) answerKeyText = answers;
    }
  }

  // 4. Send Payload to OCRNew5 multi-agent pipeline on port 8006
  const pipelineUrl = process.env.OCRNEW5_PIPELINE_URL || "http://localhost:8006/evaluate-text";
  const pipelinePayload = {
    student_id: studentId,
    exam_id: examId,
    question_paper_text: questionText,
    answer_key_text: answerKeyText,
    student_answer_text: studentAnsText || "No student answer text available.",
    max_marks: maxMarks,
  };

  logger.info(`[OCRNew5 Service] Posting payload to multi-agent pipeline: ${pipelineUrl}`);

  const evalResponse = await axios.post(pipelineUrl, pipelinePayload, {
    headers: { "Content-Type": "application/json" },
    timeout: 3600000,
  });

  const evalResult = evalResponse.data;
  logger.info("[OCRNew5 Service] Multi-agent evaluation completed successfully.");

  // 5. Save or Update AIEvaluation record in database
  try {
    let aiEval = await AIEvaluation.findOne({ where: { sheetId: sheet.sheetId } });
    const totalScore = evalResult.total_score || evalResult.score || 0;
    const feedbackText = typeof evalResult.feedback === "object" ? (evalResult.feedback.overall || JSON.stringify(evalResult.feedback)) : (evalResult.feedback || "");

    const evalPayload = {
      sheetId: sheet.sheetId,
      studentId,
      examId,
      classId: sheet.classId,
      section: sheet.section,
      subjectId: sheet.subjectId,
      examType: sheet.examType,
      status: "Success",
      totalScore,
      feedback: feedbackText,
      evaluations: evalResult.evaluations || evalResult.results || [],
      studentAnsOcr: studentAnsText,
      standardAnsOcr: answerKeyText,
      questionOcr: questionText,
      error: undefined,
    };

    if (!aiEval) {
      const evaluationId = await RegHelper.generateUserId();
      await AIEvaluation.create({ evaluationId, ...evalPayload });
    } else {
      await aiEval.update(evalPayload);
    }
    await sheet.update({ status: "Evaluated" });
  } catch (dbErr: any) {
    logger.error("[OCRNew5 Service] Failed to save evaluation to DB:", dbErr.message);
  }

  return evalResult;
};

export default {
  evaluateSheetOCRNew5,
};
