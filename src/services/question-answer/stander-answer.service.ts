
// ======================================================
// SERVICE
// src/services/questionPaperAnswer.service.ts
// ======================================================

import QuestionPaperAnswer from "../../modals/question-paper/stander-answer.model";
import RegHelper from "../../utils/helper";

class QuestionPaperAnswerService {
  // CREATE ANSWER KEY
  static async createQuestionPaperAnswer(data: any) {
    try {
      const existing = await QuestionPaperAnswer.findOne({
        where: {
          paperId: data.paperId,
          paperSet: data.paperSet,
        },
      });

      if (existing) {
        throw new Error(
          "Answer key already exists for this paper set"
        );
      }
const answerId = await RegHelper.generateUserId();
      const result = await QuestionPaperAnswer.create({
        answerId,

        instituteId: data.instituteId,

        paperId: data.paperId,

        examId: data.examId,

        teacherId: data.teacherId,

        paperSet: data.paperSet,

        answers: data.answers,

        status: data.status || "DRAFT",
      });

      return result;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }
}

export default QuestionPaperAnswerService;

