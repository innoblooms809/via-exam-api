import httpStatus from "http-status";
import Scanner from "../modals/Scanner.modal";
import Exam from "../modals/Exam.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import RegHelper from "../utils/helper";
import logger from "../config/logger";
import axios from "axios";
import FormData from "form-data";

// ─── Helper: Format question paper content into plain text ────────────────────
const formatQuestionPaper = (
  content: any,
  ansDoc?: any
): { questions: string; answers: string } => {
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
      try {
        ansData = JSON.parse(ansData);
      } catch { }
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
      if (!secName && (!section.questions || section.questions.length === 0))
        continue;

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

// ─── TRIGGER EVALUATION V2 (OCR Pipeline on port 8002) ──────────────────────
const triggerEvaluationV2 = async (
  sheetId: string,
  force: boolean = false
): Promise<any> => {
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
      const timeElapsed =
        Date.now() - new Date(aiEval.updatedAt!).getTime();
      if (timeElapsed < 180000) {
        // 3 minutes
        return {
          error: false,
          statusCode: httpStatus.OK,
          message: "Evaluation is already in progress.",
          data: aiEval,
        };
      }
      logger.info(
        `Sheet ${sheetId} has been stuck in Pending for ${Math.round(timeElapsed / 1000)}s. Overriding and starting fresh evaluation.`
      );
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
        examId: sheet.examType,
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
    let standardAnsText =
      "Provide feedback and score according to subject correctness.";

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

      // ─── Paper Set Matching (same logic as V1) ─────────────────────────────────
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
        logger.info(`[V2] No QuestionPaper found for examId '${exam.examId}' and paperSet '${targetPaperSet}'. Fetching latest QuestionPaper.`);
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

        const { questions, answers } = formatQuestionPaper(
          questionPaper.content,
          ansDoc
        );
        if (questions) questionText = questions;
        if (answers) standardAnsText = answers;
      }
    }

    // 5. Run evaluation asynchronously in the background using the NEW pipeline
    runBackgroundEvaluationV2(
      sheet,
      aiEval,
      studentId,
      examId,
      maxMarks,
      questionText,
      standardAnsText
    ).catch((err) => {
      logger.error("Background evaluation V2 trigger failed:", err);
    });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "AI evaluation (v2 pipeline) triggered successfully.",
      data: aiEval,
    };
  } catch (error: any) {
    console.error("AI Evaluation V2 initialization failed:", error);
    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Failed to initialize evaluation: ${error.message}`,
    };
  }
};

// ─── Background: Parallel OCR + Pipeline Evaluation (TESTING & PRODUCTION CONFIG) ─────────
// // TESTING & PRODUCTION CONFIGURATION:
// // Executes Student Sheet OCR (Port 8000) and Answer Key OCR / Rubric Pre-warming (Port 8007)
// // in parallel using Promise.all for maximum speed on high-spec servers.
const runBackgroundEvaluationV2 = async (
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

    // ⚡ 1. PARALLEL EXECUTION THREADS
    // Thread 1: Student Answer Sheet OCR (Port 8000)
    const studentOcrTask = (async (): Promise<string> => {
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

      logger.info(`[V2] [Thread 1] Sending student answer sheet (${fileName}, ${sheet.fileBuffer.length} bytes) to OCR API: ${ocrApiUrl}`);
      const ocrResponse = await axios.post(ocrApiUrl, ocrFormData, {
        headers: ocrFormData.getHeaders(),
        timeout: 3600000,
      });

      const studentAnsOcr = ocrResponse.data?.combined_markdown || "";
      logger.info("[V2] [Thread 1] Student answer OCR completed successfully.");
      return studentAnsOcr;
    })();

    // Thread 2: Answer Key OCR (if needed) & Pre-warming Rubric Cache on Port 8007
    const answerKeyAndRubricTask = (async (): Promise<string> => {
      let finalAnswerKeyText = standardAnsText;
      if (
        standardAnsText &&
        (standardAnsText.startsWith("http://") ||
          standardAnsText.startsWith("https://") ||
          /\.(pdf|png|jpg|jpeg|webp)$/i.test(standardAnsText.trim()))
      ) {
        try {
          logger.info(`[V2] [Thread 2] Answer key is a file URL/path. Running OCR: ${standardAnsText}`);
          const ansKeyFileRes = await axios.get(standardAnsText.trim(), { responseType: "arraybuffer" });
          const ansKeyBlob = new Blob([ansKeyFileRes.data]);
          const ansKeyFormData = new FormData();
          ansKeyFormData.append(
            "file",
            ansKeyBlob,
            "answer_key" + (standardAnsText.slice(standardAnsText.lastIndexOf(".")) || ".pdf")
          );

          const ansKeyOcrRes = await axios.post(ocrApiUrl, ansKeyFormData, { timeout: 3600000 });
          if (ansKeyOcrRes.data?.combined_markdown) {
            finalAnswerKeyText = ansKeyOcrRes.data.combined_markdown;
            logger.info("[V2] [Thread 2] Answer Key OCR completed successfully.");
          }
        } catch (ansKeyOcrErr: any) {
          logger.error("[V2] [Thread 2] Answer Key OCR failed, using original string:", ansKeyOcrErr.message);
        }
      }

      // Pre-warm Rubric Cache on Pipeline (Port 8006) in parallel
      if (questionText && finalAnswerKeyText) {
        try {
          const preprocessUrl = process.env.PIPELINE6_PREPROCESS_URL || "http://localhost:8006/preprocess-exam";
          logger.info(`[V2] [Thread 2] Pre-warming rubric cache on Pipeline: ${preprocessUrl}`);
          await axios.post(preprocessUrl, {
            exam_id: examId,
            question_paper_text: questionText,
            answer_key_text: finalAnswerKeyText,
            max_marks: maxMarks,
          }, { timeout: 30000 });
          logger.info("[V2] [Thread 2] Rubric cache pre-warmed successfully.");
        } catch (err: any) {
          logger.warn(`[V2] [Thread 2] Rubric pre-warming notification warning (will infer on demand): ${err.message}`);
        }
      }

      return finalAnswerKeyText;
    })();

    // 🚀 AWAIT BOTH THREADS IN PARALLEL
    const [studentAnsOcr, finalAnswerKeyText] = await Promise.all([studentOcrTask, answerKeyAndRubricTask]);

    // 2. Call evaluation pipeline on port 8006 (/evaluate-text)
    const pipelineUrl = process.env.OCR_PIPELINE_URL || "http://localhost:8006/evaluate-text";
    const pipelinePayload = {
      student_id: studentId,
      exam_id: examId,
      question_paper_text: questionText,
      answer_key_text: finalAnswerKeyText,
      student_answer_text: studentAnsOcr,
      max_marks: maxMarks,
    };

    logger.info(`[V2] Sending extracted text to Pipeline on port 8006: ${pipelineUrl}`);
    const evalResponse = await axios.post(pipelineUrl, pipelinePayload, {
      headers: { "Content-Type": "application/json" },
      timeout: 3600000, // 1 hour
    });

    const evalResult = evalResponse.data;
    logger.info("[V2] Pipeline v6.3 evaluation completed successfully.");
    console.log("==================== AI PIPELINE RESPONSE ====================");
    console.log(JSON.stringify(evalResult, null, 2));
    console.log("==============================================================");

    // 3. Map pipeline response to clean AIEvaluation DB schema without duplication
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
          reason: "Evaluated by AI pipeline"
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

    // 4. Save Successful Evaluation Details
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

    console.log("==================== SAVED DB EVALUATION ====================");
    console.log(JSON.stringify({
      status: "Success",
      totalScore: totalObtainedScore,
      summary: evalResult.summary,
      questionsCount: mappedQuestions.length,
      evaluationsSample: mappedQuestions[0]
    }, null, 2));
    console.log("=============================================================");



    // 5. Update Scanner sheet status to Evaluated
    await sheet.update({ status: "Evaluated" });
  } catch (error: any) {
    logger.error(
      `[V2] AI Evaluation background job failed for sheet ${sheet.sheetId}:`,
      error
    );

    // Update status as Failed
    await aiEval.update({
      status: "Failed",
      error:
        error.message ||
        "Unknown error occurred during background AI evaluation (v2).",
    });
  }
};

export default {
  triggerEvaluationV2,
};
