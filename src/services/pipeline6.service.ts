import httpStatus from "http-status";
import Scanner from "../modals/Scanner.modal";
import Exam from "../modals/Exam.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import ApiError from "../utils/ApiError";
import logger from "../config/logger";
import axios from "axios";
import FormData from "form-data";

// Helper to format question paper content into text
const formatQuestionPaper = (content: any, ansDoc?: any): { questions: string; answers: string; calculatedTotalMarks: number } => {
  let questions = "";
  let answers = "";
  let calculatedTotalMarks = 0;

  if (!content) {
    return { questions: "", answers: "", calculatedTotalMarks: 0 };
  }

  let parsedContent = content;
  if (typeof content === "string") {
    try {
      parsedContent = JSON.parse(content);
    } catch (e) {
      return { questions: content, answers: "", calculatedTotalMarks: 0 };
    }
  }

  let answerMap: { [key: string]: any } = {};
  if (ansDoc) {
    let parsedAns = ansDoc;
    if (typeof ansDoc === "string") {
      try {
        parsedAns = JSON.parse(ansDoc);
      } catch (e) {}
    }

    if (Array.isArray(parsedAns)) {
      parsedAns.forEach((item: any) => {
        const qId = String(item.questionId || item.question_id || item.id || "");
        if (qId) answerMap[qId] = item;
      });
    } else if (typeof parsedAns === "object" && parsedAns !== null) {
      if (Array.isArray(parsedAns.answers)) {
        parsedAns.answers.forEach((item: any) => {
          const qId = String(item.questionId || item.question_id || item.id || "");
          if (qId) answerMap[qId] = item;
        });
      } else {
        Object.keys(parsedAns).forEach((key) => {
          answerMap[key] = parsedAns[key];
        });
      }
    }
  }

  let foundQuestions = false;

  const processSingleQuestion = (q: any) => {
    foundQuestions = true;
    const qId = String(q.questionId || q.id || q.number || "");
    const qText = q.questionText || q.text || q.title || q.question || "";
    const rawMarks = q.marks !== undefined ? q.marks : q.maxMarks;
    const numMarks = Number(rawMarks);
    if (!isNaN(numMarks) && numMarks > 0) {
      calculatedTotalMarks += numMarks;
    }

    const marksFormatted =
      !isNaN(numMarks) && numMarks > 0
        ? `[Marks: ${numMarks}]`
        : rawMarks !== null && rawMarks !== undefined && rawMarks !== ""
        ? `[Marks: ${rawMarks}]`
        : "";

    questions += `${qId}. ${qText} ${marksFormatted}\n`.trim() + "\n";

    const expectedAns =
      answerMap[qId]?.answer ||
      answerMap[q.id]?.answer ||
      q.answer ||
      q.expectedAnswer ||
      "";
    if (expectedAns) {
      answers += `${qId}. Expected Answer: ${expectedAns}\n`;
    }
  };

  if (Array.isArray(parsedContent.sections) && parsedContent.sections.length > 0) {
    for (const section of parsedContent.sections) {
      const secName = section.name || section.title || "";
      if (!secName && (!section.questions || section.questions.length === 0)) continue;

      questions += `\n--- Section: ${secName} ---\n`;
      if (section.instructions) {
        questions += `Instructions: ${section.instructions}\n`;
      }
      if (Array.isArray(section.questions)) {
        for (const q of section.questions) {
          processSingleQuestion(q);
        }
      }
    }
  }

  if (Array.isArray(parsedContent.questions) && parsedContent.questions.length > 0) {
    if (!parsedContent.sections || parsedContent.sections.length === 0) {
      questions += `\n--- Questions ---\n`;
    }
    for (const q of parsedContent.questions) {
      processSingleQuestion(q);
    }
  }

  if (!foundQuestions && typeof parsedContent === "object") {
    questions = JSON.stringify(parsedContent, null, 2);
  }

  return { questions, answers, calculatedTotalMarks };
};

// ─── Pipeline 6.3 Evaluation Trigger ──────────────────────────────────────────
export const triggerPipeline6Evaluation = async (
  sheetId: string,
  force: boolean = false
): Promise<any> => {
  try {
    // 1. Fetch Scanner Sheet
    const sheet: any = (await Scanner.findOne({ where: { sheetId, isDeleted: false } })) || (await Scanner.findByPk(sheetId));
    if (!sheet) {
      return {
        error: true,
        statusCode: httpStatus.NOT_FOUND,
        message: "Scanner sheet not found.",
      };
    }

    // 2. Find or reset AIEvaluation record
    let aiEval: any = await AIEvaluation.findOne({ where: { sheetId } });

    if (aiEval && aiEval.status === "Pending" && !force) {
      const timeElapsed = Date.now() - new Date(aiEval.updatedAt!).getTime();
      if (timeElapsed < 60000) { // 1 minute protection against rapid double clicks
        return {
          error: false,
          statusCode: httpStatus.OK,
          message: "Pipeline 6.3 evaluation is already in progress.",
          data: aiEval,
        };
      }
      logger.info(`Sheet ${sheetId} has been in Pending for ${Math.round(timeElapsed / 1000)}s. Starting fresh Pipeline 6.3 evaluation.`);
    }

    // 3. Resolve Student, Question Paper, Answer Key
    const student = await StudentProfile.findOne({
      where: { rollNumber: sheet.rollNo, instituteId: sheet.instituteId, classId: sheet.classId },
    });
    const studentId = student ? student.userId : (sheet.studentId || `STUDENT-${sheet.rollNo}`);
    let examId = sheet.examType || "EXAM-1";
    let maxMarks = 10;
    let questionText = "Evaluate student answer sheet.";
    let standardAnsText = "";

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

        const { questions, answers, calculatedTotalMarks } = formatQuestionPaper(questionPaper.content, qpAnswer ? qpAnswer.answers : null);
        if (questions) questionText = questions;
        if (answers) standardAnsText = answers;
        if (calculatedTotalMarks > 0) {
          maxMarks = calculatedTotalMarks;
        }
      }
    }

    // 4. Upsert AIEvaluation Record
    if (!aiEval) {
      aiEval = await AIEvaluation.create({
        sheetId,
        studentId,
        examId,
        classId: sheet.classId || "",
        subjectId: sheet.subjectId || "",
        examType: sheet.examType || "",
        section: sheet.section || "",
        status: "Pending",
        totalScore: 0,
        evaluations: [],
      });
    } else {
      await aiEval.update({
        status: "Pending",
        error: undefined,
      });
    }

    // 5. Fire Async Pipeline 6.3 Background Job
    runBackgroundPipeline6Evaluation(
      sheet,
      aiEval,
      studentId,
      examId,
      maxMarks,
      questionText,
      standardAnsText
    ).catch((err) => {
      logger.error("[Pipeline6 Service] Background evaluation job failed:", err);
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Pipeline 6.3 AI evaluation triggered successfully.",
      data: aiEval,
    };
  } catch (error: any) {
    logger.error("[Pipeline6 Service] Initialization failed:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to initialize Pipeline 6.3 evaluation: ${error.message}`,
    };
  }
};

// ─── Background Execution: Parallel Student OCR + Rubric Pre-warming + Pipeline 6 ────────
const runBackgroundPipeline6Evaluation = async (
  sheet: any,
  aiEval: any,
  studentId: string,
  examId: string,
  maxMarks: number,
  questionText: string,
  standardAnsText: string
): Promise<void> => {
  try {
    const ocrApiUrl = process.env.OCR_API_URL || "http://localhost:8000/ocrOutput";
    const pipeline6Url = process.env.OCR6_PIPELINE_URL || process.env.PIPELINE6_API_URL || process.env.OCR_PIPELINE_URL || "http://localhost:8007/evaluate-text";
    const preprocessUrl = process.env.PIPELINE6_PREPROCESS_URL || "http://localhost:8007/preprocess-exam";

    // ⚡ 1. PARALLEL THREADS
    // Thread 1: Student Answer Sheet OCR (Port 8000)
    const studentOcrTask = (async (): Promise<string> => {
      let studentAnsText = sheet.ocrText || sheet.answerText || "";
      if (!studentAnsText && sheet.fileBuffer && sheet.fileBuffer.length > 0) {
        let fileName = sheet.fileName || "sheet.png";
        if (!/\.(png|jpg|jpeg|webp|pdf)$/i.test(fileName)) {
          const ext = sheet.fileMimeType === "application/pdf" ? ".pdf" : ".png";
          fileName = `${fileName}${ext}`;
        }

        const ocrFormData = new FormData();
        ocrFormData.append("file", sheet.fileBuffer, {
          filename: fileName,
          contentType: sheet.fileMimeType || "image/png",
        });

        logger.info(`[Pipeline6 Service] [Thread 1] Sending student answer sheet (${fileName}, ${sheet.fileBuffer.length} bytes) to OCR API: ${ocrApiUrl}`);
        const ocrResponse = await axios.post(ocrApiUrl, ocrFormData, {
          headers: ocrFormData.getHeaders(),
          timeout: 3600000,
        });

        studentAnsText = ocrResponse.data?.combined_markdown || "";
        logger.info(`[Pipeline6 Service] [Thread 1] Student answer OCR completed (${studentAnsText.length} chars).`);
      }
      return studentAnsText;
    })();

    // Thread 2: Answer Key OCR (if file) & Pre-warming Rubric Cache on Pipeline 6 (Port 8007)
    const answerKeyAndRubricTask = (async (): Promise<string> => {
      let finalAnswerKeyText = standardAnsText;
      if (
        standardAnsText &&
        (standardAnsText.startsWith("http://") ||
          standardAnsText.startsWith("https://") ||
          /\.(pdf|png|jpg|jpeg|webp)$/i.test(standardAnsText.trim()))
      ) {
        try {
          logger.info(`[Pipeline6 Service] [Thread 2] Answer key is a file URL/path. Running OCR: ${standardAnsText}`);
          const ansKeyFileRes = await axios.get(standardAnsText.trim(), { responseType: "arraybuffer" });
          const ansKeyFormData = new FormData();
          ansKeyFormData.append(
            "file",
            ansKeyFileRes.data,
            "answer_key" + (standardAnsText.slice(standardAnsText.lastIndexOf(".")) || ".pdf")
          );

          const ansKeyOcrRes = await axios.post(ocrApiUrl, ansKeyFormData, {
            headers: ansKeyFormData.getHeaders(),
            timeout: 3600000,
          });
          if (ansKeyOcrRes.data?.combined_markdown) {
            finalAnswerKeyText = ansKeyOcrRes.data.combined_markdown;
            logger.info("[Pipeline6 Service] [Thread 2] Answer Key OCR completed successfully.");
          }
        } catch (ansKeyOcrErr: any) {
          logger.error("[Pipeline6 Service] [Thread 2] Answer Key OCR failed, using original string:", ansKeyOcrErr.message);
        }
      }

      // Pre-warm Exam Rubric Cache on Pipeline 6 (Port 8007)
      if (questionText && finalAnswerKeyText) {
        try {
          logger.info(`[Pipeline6 Service] [Thread 2] Pre-warming rubric cache on Pipeline 6: ${preprocessUrl}`);
          await axios.post(preprocessUrl, {
            exam_id: examId,
            question_paper_text: questionText,
            answer_key_text: finalAnswerKeyText,
            max_marks: maxMarks,
          }, { timeout: 30000 });
          logger.info("[Pipeline6 Service] [Thread 2] Rubric cache pre-warmed successfully.");
        } catch (err: any) {
          logger.warn(`[Pipeline6 Service] [Thread 2] Rubric pre-warming notification warning (will infer on demand): ${err.message}`);
        }
      }

      return finalAnswerKeyText;
    })();

    // 🚀 AWAIT BOTH PARALLEL THREADS
    const [studentAnsOcr, finalAnswerKeyText] = await Promise.all([studentOcrTask, answerKeyAndRubricTask]);

    // 2. Dispatch Payload to Pipeline 6.3 Evaluation Endpoint (Port 8007)
    const pipelinePayload = {
      student_id: studentId,
      exam_id: examId,
      question_paper_text: questionText,
      answer_key_text: finalAnswerKeyText,
      student_answer_text: studentAnsOcr || "No student answer text available.",
      max_marks: maxMarks,
    };

    logger.info(`[Pipeline6 Service] Posting payload to Pipeline 6.3 endpoint: ${pipeline6Url}`);
    const evalResponse = await axios.post(pipeline6Url, pipelinePayload, {
      headers: { "Content-Type": "application/json" },
      timeout: 3600000, // 1 hour
    });

    const evalResult = evalResponse.data;
    logger.info("[Pipeline6 Service] Pipeline 6.3 evaluation completed successfully.");
    console.log("==================== PIPELINE 6.3 RESPONSE ====================");
    console.log(JSON.stringify(evalResult, null, 2));
    console.log("===============================================================");

    // 3. Map Pipeline 6.3 response to clean AIEvaluation DB schema
    const rawQuestions = evalResult.questions || evalResult.evaluations || [];
    const mappedQuestions = rawQuestions.map((q: any) => ({
      questionId: q.questionId || q.question_id || "",
      questionText: q.questionText || q.question_text || q.question || "",
      studentAnswer: q.studentAnswer || q.student_answer_snippet || "",
      expectedAnswer: q.expectedAnswer || "",
      marks: q.marks || {
        obtained: q.obtainedMarks !== undefined ? q.obtainedMarks : (q.score || 0),
        maximum: q.maxMarks !== undefined ? q.maxMarks : (q.max_marks || 0),
      },
      status: q.status || "Incorrect",
      evaluation: q.evaluation || {
        confidence: typeof q.confidence === "object" ? q.confidence : {
          score: q.confidence !== undefined ? q.confidence : 1.0,
          reason: "Evaluated by Pipeline 6.3 multi-agent engine"
        },
        reasoning: typeof q.reasoning === "object" ? q.reasoning : {
          analysis: q.reasoning || q.feedback || "",
          comparison: {
            student: q.studentAnswer || "",
            expected: q.expectedAnswer || "",
          },
          conceptsIdentified: q.strengths || [],
          missingConcepts: q.missingConcepts || q.missing_concepts || [],
          markJustification: `Awarded ${q.obtainedMarks || q.score || 0} marks based on answer analysis.`
        },
        feedback: typeof q.feedback === "string" ? q.feedback : (q.feedback?.overall || "Evaluated"),
        strengths: q.strengths || [],
        improvements: q.missingConcepts || q.missing_concepts || [],
        keywords: {
          matched: q.keywordsMatched || q.keywords?.matched || [],
          missing: q.keywordsMissing || q.keywords?.missing || [],
        }
      }
    }));

    const totalObtainedScore = evalResult.summary ? evalResult.summary.obtainedMarks : (evalResult.total_score || 0);

    // 4. Update AIEvaluation Details in Database
    await aiEval.update({
      status: "Success",
      totalScore: totalObtainedScore,
      feedback: typeof evalResult.feedback === "object" ? (evalResult.feedback.overall || JSON.stringify(evalResult.feedback)) : (evalResult.feedback || ""),
      evaluations: mappedQuestions,
      summary: evalResult.summary || null,
      metadata: evalResult.metadata || null,
      studentAnsOcr: studentAnsOcr,
      standardAnsOcr: finalAnswerKeyText,
      questionOcr: questionText,
      error: null,
    });

    // 5. Update Scanner Sheet status to Evaluated
    await sheet.update({ status: "Evaluated" });
    logger.info(`[Pipeline6 Service] Successfully completed and saved evaluation for sheet: ${sheet.sheetId}`);
  } catch (error: any) {
    logger.error(`[Pipeline6 Service] Evaluation background job failed for sheet ${sheet.sheetId}:`, error);

    await aiEval.update({
      status: "Failed",
      error: error.message || "Unknown error occurred during background Pipeline 6.3 AI evaluation.",
    });
  }
};

export default {
  triggerPipeline6Evaluation,
};
