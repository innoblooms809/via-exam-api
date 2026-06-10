import httpStatus from "http-status";
import Scanner from "../modals/Scanner.modal";
import Exam from "../modals/Exam.modal";
import QuestionPaper from "../modals/question-paper/QuestionPaper.modal";
import QuestionPaperAnswer from "../modals/question-paper/stander-answer.model";
import AIEvaluation from "../modals/AIEvaluation.modal";
import StudentProfile from "../modals/Student.modal";
import RegHelper from "../utils/helper";

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
      try { ansData = JSON.parse(ansData); } catch {}
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
      return {
        error: false,
        statusCode: httpStatus.OK,
        message: "Evaluation is already in progress.",
        data: aiEval,
      };
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

    // Try to find the matching Exam
    const exam = await Exam.findOne({
      where: {
        instituteId: sheet.instituteId,
        classId: sheet.classId,
        subjectId: sheet.subjectId,
        examType: sheet.examType,
        isDeleted: false,
      },
    });

    if (exam) {
      examId = exam.examId;
      maxMarks = exam.totalMarks || 10;

      // Try to find the approved or published Question Paper for this Exam
      const questionPaper = await QuestionPaper.findOne({
        where: {
          examId: exam.examId,
          instituteId: sheet.instituteId,
        },
      });

      if (questionPaper) {
        // Find matching answers from QuestionPaperAnswer
        const qpAnswer = await QuestionPaperAnswer.findOne({
          where: { paperId: questionPaper.paperId }
        });
        const ansDoc = qpAnswer ? qpAnswer.answers : null;

        const { questions, answers } = formatQuestionPaper(questionPaper.content, ansDoc);
        if (questions) questionText = questions;
        if (answers) standardAnsText = answers;
      }
    }

    // 5. Send file buffer to Python API (OCR + Evaluation)
    const pythonApiUrl = process.env.PYTHON_API_URL || "http://localhost:8000/ocr-evaluation-text-ref";
    
    // Construct FormData using Node 18 native Blob & FormData
    const formData = new FormData();
    const fileBlob = new Blob([sheet.fileBuffer], { type: sheet.fileMimeType });
    
    formData.append("student_ans", fileBlob, sheet.fileName);
    formData.append("question_text", questionText);
    formData.append("standard_ans_text", standardAnsText);
    formData.append("max_marks", String(maxMarks));
    formData.append("student_id", studentId);
    formData.append("exam_id", examId);

    // Run fetch calling the python api
    const response = await fetch(pythonApiUrl, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python API Error (${response.status}): ${errorText}`);
    }

    const result = await response.json();

    // 6. Save Successful Evaluation Details
    await aiEval.update({
      status: "Success",
      totalScore: result.total_score || 0,
      feedback: result.feedback || "",
      evaluations: result.evaluations || [],
      studentAnsOcr: result.student_ans_ocr || "",
      standardAnsOcr: standardAnsText,
      questionOcr: questionText,
    });

    // 7. Update Scanner sheet status to Evaluated so it shows up in UI
    await sheet.update({ status: "Evaluated" });

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation completed successfully.",
      data: aiEval,
    };

  } catch (error: any) {
    console.error("AI Evaluation failed:", error);
    
    // Update AI Evaluation status as Failed
    const aiEval = await AIEvaluation.findOne({ where: { sheetId } });
    if (aiEval) {
      await aiEval.update({
        status: "Failed",
        error: error.message || "Unknown error occurred during AI evaluation.",
      });
    }

    return {
      error: true,
      statusCode: httpStatus.INTERNAL_SERVER_ERROR,
      message: `Evaluation failed: ${error.message}`,
    };
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

    return {
      error: false,
      statusCode: httpStatus.OK,
      message: "Evaluation details fetched.",
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

export default {
  triggerEvaluation,
  getEvaluationBySheetId,
  getAllEvaluations,
};
