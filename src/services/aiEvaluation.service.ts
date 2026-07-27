import httpStatus from "http-status";
import Scanner from "../modals/Scanner.modal";
import Exam from "../modals/Exam.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import User from "../modals/User.modal";
import Class from "../modals/Class.modal";
import RegHelper from "../utils/helper";
import logger from "../config/logger";
import axios from "axios";

// Helper to format question paper content into text
const formatQuestionPaper = (content: any, ansDoc?: any): { questions: string; answers: string } => {
  let questions = "";
  let answers = "";

  if (!content) {
    return { questions, answers };
  }

  // Parse ansDoc map
  const answerMap: Record<string, any> = {};
  if (ansDoc) {
    let ansData = ansDoc;
    if (typeof ansData === "string") {
      try { ansData = JSON.parse(ansData); } catch { }
    }
    if (Array.isArray(ansData)) {
      ansData.forEach((a: any) => {
        const id = a.questionId || a.id || a.key;
        if (id) {
          answerMap[id] = a;
        }
      });
    } else if (ansData && typeof ansData === "object") {
      Object.keys(ansData).forEach((key) => {
        const a = ansData[key];
        const id = a.questionId || a.id || a.key || key;
        answerMap[id] = a;
      });
    }
  }

  // Handle case where title is available
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
    // Fallback simple stringify for non-standard JSON schemas
    questions = JSON.stringify(content, null, 2);
  }

  return { questions, answers };
};

// ─── TRIGGER EVALUATION ───────────────────────────────────────────────────────
const triggerEvaluation = async (sheetId: string, force: boolean = false): Promise<any> => {
  try {
    // 1. Fetch Scanner Sheet
    const sheet = await Scanner.findOne({
      where: { sheetId, isDeleted: false },
    });

    if (!sheet) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Answer sheet not found.",
      };
    }

    // 2. Check if already evaluating or completed
    let aiEval = await AIEvaluation.findOne({ where: { sheetId } });
    if (aiEval && aiEval.status === "Success" && !force) {
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "Sheet already evaluated.",
        data: aiEval,
      };
    }

    if (aiEval && aiEval.status === "Pending" && !force) {
      const timeElapsed = Date.now() - new Date(aiEval.updatedAt!).getTime();
      if (timeElapsed < 180000) { // 3 minutes
        return {
          error: false,
          statusCode: httpStatus.OK,
          message: "Evaluation is already in progress.",
          data: aiEval,
        };
      }
      logger.info(`Sheet ${sheetId} has been stuck in Pending for ${Math.round(timeElapsed / 1000)}s. Overriding and starting fresh evaluation.`);
    }

    // Lookup Student
    const student = await StudentProfile.findOne({
      where: {
        rollNumber: sheet.rollNo,
        instituteId: sheet.instituteId,
        classId: sheet.classId,
      },
    });

    const studentId = student ? student.userId : `STUDENT-${sheet.rollNo}`;

    // 3. Find or Create AIEvaluation record as Pending
    const evaluationId = await RegHelper.generateUserId();
    if (!aiEval) {
      aiEval = await AIEvaluation.create({
        evaluationId,
        sheetId,
        studentId,
        examId: sheet.examType, // using the scan examType as exam identifier
        classId: sheet.classId,
        section: sheet.section,
        subjectId: sheet.subjectId,
        examType: sheet.examType,
        status: "Pending",
        totalScore: 0,
        feedback: "",
        evaluations: [],
        studentAnsOcr: "",
        standardAnsOcr: "",
        questionOcr: "",
      });
    } else {
      await aiEval.update({
        status: "Pending",
        error: undefined,
      });
    }

    // 4. Resolve Exam and Question Paper details
    let examId = sheet.examType;
    let maxMarks = 10;
    let questionText = "Evaluate the student's answer sheet.";
    let standardAnsText = "Provide feedback and score according to subject correctness.";

    // Try to find the matching Exam (ordered by latest created)
    const exam = await Exam.findOne({
      where: {
        instituteId: sheet.instituteId,
        classId: sheet.classId,
        subjectId: sheet.subjectId,
        examType: sheet.examType,
        isDeleted: false,
      },
      order: [["createdAt", "DESC"]],
    });

    if (exam) {
      examId = exam.examId;
      maxMarks = exam.totalMarks || 10;

      // Target paperSet from student sheet section (e.g. "A", "B", etc.)
      const targetPaperSet = sheet.section || "A";

      // 1. Try matching exact paperSet for this exam & section
      let questionPaper = await QuestionPaper.findOne({
        where: {
          examId: exam.examId,
          instituteId: sheet.instituteId,
          paperSet: targetPaperSet,
        },
        order: [["createdAt", "DESC"]],
      });

      // 2. Fallback: if no paperSet match for this examId, try finding any QuestionPaper for this examId
      if (!questionPaper) {
        logger.info(`No QuestionPaper found for examId '${exam.examId}' and paperSet '${targetPaperSet}'. Fetching latest QuestionPaper for examId '${exam.examId}'.`);
        questionPaper = await QuestionPaper.findOne({
          where: {
            examId: exam.examId,
            instituteId: sheet.instituteId,
          },
          order: [["createdAt", "DESC"]],
        });
      }

      if (questionPaper) {
        // Find matching answers from QuestionPaperAnswer for paperId & paperSet
        let qpAnswer = await QuestionPaperAnswer.findOne({
          where: {
            paperId: questionPaper.paperId,
            paperSet: questionPaper.paperSet,
          },
        });
        if (!qpAnswer) {
          qpAnswer = await QuestionPaperAnswer.findOne({
            where: { paperId: questionPaper.paperId },
          });
        }
        const ansDoc = qpAnswer ? qpAnswer.answers : null;

        const { questions, answers } = formatQuestionPaper(questionPaper.content, ansDoc);
        if (questions) questionText = questions;
        if (answers) standardAnsText = answers;
      }
    }

    // 5. Run evaluation asynchronously in the background
    runBackgroundEvaluation(
      sheet,
      aiEval,
      studentId,
      examId,
      maxMarks,
      questionText,
      standardAnsText
    ).catch((err) => {
      logger.error("Background evaluation trigger failed:", err);
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "AI evaluation triggered successfully.",
      data: aiEval,
    };

  } catch (error: any) {
    console.error("AI Evaluation initialization failed:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to initialize evaluation: ${error.message}`,
    };
  }
};

// Helper function to execute OCR & Evaluation in the background
const runBackgroundEvaluation = async (
  sheet: any,
  aiEval: any,
  studentId: string,
  examId: string,
  maxMarks: number,
  questionText: string,
  standardAnsText: string
): Promise<void> => {
  try {
    // 1. Check file buffer validity
    if (!sheet.fileBuffer || sheet.fileBuffer.length === 0) {
      throw new Error("Answer sheet image file buffer is missing or empty in database.");
    }

    // Ensure filename has a valid extension (.png, .jpg, .jpeg, .webp, .pdf) for python ocr_server
    let fileName = sheet.fileName || "sheet.png";
    if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
      const ext = sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
      fileName = `${fileName}${ext}`;
    }

    // Call OCR API
    const ocrApiUrl = process.env.OCR_API_URL || "http://localhost:8000/ocrOutput";
    const ocrFormData = new FormData();
    const fileBlob = new Blob([sheet.fileBuffer], { type: sheet.fileMimeType || "image/png" });
    ocrFormData.append("file", fileBlob, fileName);

    logger.info(`Sending student answer sheet (${fileName}, ${sheet.fileBuffer.length} bytes) to OCR API: ${ocrApiUrl}`);
    const ocrResponse = await axios.post(ocrApiUrl, ocrFormData, {
      timeout: 3600000, // 1 hour
    });

    const ocrResult = ocrResponse.data;
    const studentAnsOcr = ocrResult.combined_markdown || "";
    logger.info("OCR completed successfully (background).");

    // 2. Call Evaluation API
    const evaluationApiUrl = process.env.EVALUATION_API_URL || "http://localhost:8002/evaluation";
    const evalFormData = new FormData();
    evalFormData.append("student_id", studentId);
    evalFormData.append("exam_id", examId);
    evalFormData.append("question", questionText);
    evalFormData.append("expected_answer", standardAnsText);
    evalFormData.append("student_answer", studentAnsOcr);
    evalFormData.append("max_marks", String(maxMarks));

    logger.info(`Sending extracted text to Evaluation API (background): ${evaluationApiUrl}`);
    const evalResponse = await axios.post(evaluationApiUrl, evalFormData, {
      timeout: 3600000, // 1 hour
    });

    const evalResult = evalResponse.data;
    logger.info("Evaluation completed successfully (background).");

    // 3. Save Successful Evaluation Details
    await aiEval.update({
      status: "Success",
      totalScore: evalResult.total_score || 0,
      feedback: evalResult.feedback || "",
      evaluations: evalResult.evaluations || [],
      studentAnsOcr: studentAnsOcr,
      standardAnsOcr: standardAnsText,
      questionOcr: questionText,
      error: null, // clear previous errors if any
    });

    // 4. Update Scanner sheet status to Evaluated
    await sheet.update({ status: "Evaluated" });

  } catch (error: any) {
    const detailMsg =
      error?.response?.data?.detail ||
      error?.response?.data?.message ||
      (typeof error?.response?.data === "string" ? error.response.data : null) ||
      error?.message ||
      "Unknown error occurred during background AI evaluation.";

    logger.error(`AI Evaluation background job failed for sheet ${sheet.sheetId}:`, {
      message: error.message,
      responseData: error?.response?.data,
      status: error?.response?.status,
    });

    // Update status as Failed with full error detail
    await aiEval.update({
      status: "Failed",
      error: detailMsg,
    });
  }
};

// ─── GET EVALUATION BY SHEET ID ───────────────────────────────────────────────
const getEvaluationBySheetId = async (sheetId: string): Promise<any> => {
  try {
    const aiEval = await AIEvaluation.findOne({ where: { sheetId } });
    if (!aiEval) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Evaluation details not found for this sheet.",
      };
    }

    let studentName = "";
    let className = "";

    try {
      const student = await User.findOne({ where: { userId: aiEval.studentId } });
      if (student) {
        studentName = student.userName;
      }
    } catch (err) {
      logger.error("Failed to resolve student name for evaluation details:", err);
    }

    try {
      const classObj = await Class.findOne({ where: { classId: aiEval.classId } });
      if (classObj) {
        className = classObj.className;
      }
    } catch (err) {
      logger.error("Failed to resolve class name for evaluation details:", err);
    }

    const evalDataJson = aiEval.toJSON() as any;
    evalDataJson.studentName = studentName;
    evalDataJson.className = className;

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation details fetched.",
      data: evalDataJson,
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

// ─── GET ALL EVALUATIONS (list with filters) ──────────────────────────────────
const getAllEvaluations = async (query: any, requestedBy: any): Promise<any> => {
  try {
    const { classId, section, subjectId, examType, status } = query;
    const where: any = {};

    if (classId) where.classId = classId;
    if (section) where.section = section;
    if (subjectId) where.subjectId = subjectId;
    if (examType) where.examType = examType;
    if (status) where.status = status;

    const evaluations = await AIEvaluation.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "AI evaluations list fetched successfully.",
      data: { evaluations, total: evaluations.length },
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

// ─── UPDATE EVALUATION BY SHEET ID ────────────────────────────────────────────
const updateEvaluationBySheetId = async (
  sheetId: string,
  data: { totalScore: number; evaluations: any; feedback?: string }
): Promise<any> => {
  try {
    const aiEval = await AIEvaluation.findOne({ where: { sheetId } });
    if (!aiEval) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Evaluation details not found for this sheet.",
      };
    }

    await aiEval.update({
      totalScore: data.totalScore,
      evaluations: data.evaluations,
      feedback: data.feedback !== undefined ? data.feedback : aiEval.feedback,
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation details updated successfully.",
      data: aiEval,
    };
  } catch (error: any) {
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Something went wrong: ${error.message}`,
    };
  }
};

export default {
  triggerEvaluation,
  getEvaluationBySheetId,
  getAllEvaluations,
  updateEvaluationBySheetId,
};

