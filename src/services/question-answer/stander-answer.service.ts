import QuestionPaperAnswer from "../../modals/question-paper/stander-answer.model";
import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Notification from "../../modals/Notification.modal";
import RegHelper from "../../utils/helper";
import ApiError from "../../utils/ApiError";
import httpStatus from "http-status";
import {
  markExamPaperCreated,
  refreshExamStatus,
} from "../exam.service";
import { QuestionPaperService, assertEditableStatus, isTeacherUser } from "./questionPaper.service";
import { cleanupUploadsInBackground, collectUploadRefs } from "../uploadedFiles.service";
import { reconcileTypedAnswers } from "../../utils/answerSheetReconcile";

/**
 * Stores on every typed answer which question it answers (text, marks, number), so
 * the answers can be re-linked if the paper is later rebuilt or edited
 * (see utils/answerSheetReconcile). Uploaded-PDF answer sheets pass through as-is.
 */
async function withQuestionSnapshots(answers: unknown, paperId: string): Promise<object> {
  const paper = paperId ? await QuestionPaper.findOne({ where: { paperId } }) : null;
  const stamped = paper ? reconcileTypedAnswers(answers, paper.content, null) : null;
  return (stamped ? stamped.answers : answers) as object;
}

class QuestionPaperAnswerService {
  // ─────────────────────────────────────────────
  // CREATE ANSWER KEY
  // ─────────────────────────────────────────────

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
        answers: await withQuestionSnapshots(data.answers, data.paperId),
        status: data.status || "DRAFT",
      });

      if (data.examId) {
        await markExamPaperCreated(data.examId);
      }

      return result;
    } catch (error: any) {
      throw new Error(error.message);
    }
  }

  // ─────────────────────────────────────────────
  // SAVE ANSWER SHEET PDF URL
  // ─────────────────────────────────────────────
  static async saveAnswerSheetPdfUrl(data: {
    paperId: string;
    examId: string;
    paperSet: "A" | "B" | "C" | "D";
    instituteId: string;
    teacherId: string;
    pdfUrl: string;
  }) {
    try {
      // The set's answer sheet: linked to this paper, or kept from a deleted paper of the same set.
      const existing = await QuestionPaperAnswer.findOne({
        where: {
          paperId: data.paperId,
          paperSet: data.paperSet,
        },
      }) || await QuestionPaperAnswer.findOne({
        where: { examId: data.examId, paperSet: data.paperSet },
        order: [["updatedAt", "DESC"]],
      });

      if (existing) {
        assertEditableStatus(existing.status, "answer sheet", "replaced");
        const filesBefore = collectUploadRefs(existing.answers);
        await existing.update({
          paperId: data.paperId,
          answers: { pdfUrl: data.pdfUrl },
          teacherId: data.teacherId,
          instituteId: data.instituteId,
          examId: data.examId,
        });
        // The replaced PDF (and any old answer diagrams) are no longer used.
        cleanupUploadsInBackground(filesBefore, `replacing answer sheet ${existing.answerId}`);
        return existing;
      } else {
        const answerId = await RegHelper.generateUserId();
        const result = await QuestionPaperAnswer.create({
          answerId,
          instituteId: data.instituteId,
          paperId: data.paperId,
          examId: data.examId,
          teacherId: data.teacherId,
          paperSet: data.paperSet,
          answers: { pdfUrl: data.pdfUrl },
          status: "DRAFT",
        });
        await markExamPaperCreated(data.examId);
        return result;
      }
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new Error(error.message);
    }
  }

  // ─────────────────────────────────────────────
  // FIND AN ANSWER SHEET THE USER MAY CHANGE
  // ─────────────────────────────────────────────

  static async findAnswerForUser(answerId: string, user: any) {
    const answer = await QuestionPaperAnswer.findOne({ where: { answerId } });

    if (!answer || (user?.instituteId && answer.instituteId !== user.instituteId)) {
      throw new ApiError(httpStatus.NOT_FOUND, "Answer sheet not found");
    }

    if (isTeacherUser(user) && answer.teacherId !== user.userId) {
      // Older answer sheets were saved under a fixed teacher id, so also accept
      // the teacher who owns the matching question paper.
      const paper = await QuestionPaper.findOne({ where: { paperId: answer.paperId } });
      if (!paper || paper.teacherId !== user.userId) {
        throw new ApiError(httpStatus.FORBIDDEN, "You can only change your own answer sheet");
      }
    }

    return answer;
  }

  // Throws before anything is uploaded when an existing answer sheet is locked.
  static async assertReplaceable(paperId: string, paperSet: string, examId?: string) {
    const existing = await QuestionPaperAnswer.findOne({ where: { paperId, paperSet } }) ||
      (examId
        ? await QuestionPaperAnswer.findOne({ where: { examId, paperSet: paperSet as any }, order: [["updatedAt", "DESC"]] })
        : null);
    if (existing) assertEditableStatus(existing.status, "answer sheet", "replaced");
  }

  // ─────────────────────────────────────────────
  // UPDATE ANSWER SHEET  (DRAFT / REJECTED only)
  // ─────────────────────────────────────────────

  static async updateQuestionPaperAnswer(answerId: string, user: any, answers: unknown) {
    if (!answers || typeof answers !== "object") {
      throw new ApiError(httpStatus.BAD_REQUEST, "answers must be an array or object");
    }

    const answer = await QuestionPaperAnswerService.findAnswerForUser(answerId, user);
    assertEditableStatus(answer.status, "answer sheet", "edited");

    const filesBefore = collectUploadRefs(answer.answers);
    await answer.update({ answers: await withQuestionSnapshots(answers, answer.paperId) });
    // A replaced uploaded PDF / removed answer diagrams are no longer used.
    cleanupUploadsInBackground(filesBefore, `editing answer sheet ${answerId}`);
    return answer;
  }

  // ─────────────────────────────────────────────
  // DELETE ANSWER SHEET  (DRAFT / REJECTED only)
  // Independent of the question paper: the paper is never touched. The uploaded
  // PDF / answer diagrams of this answer sheet are removed with it.
  // ─────────────────────────────────────────────

  static async deleteQuestionPaperAnswer(answerId: string, user: any) {
    const answer = await QuestionPaperAnswerService.findAnswerForUser(answerId, user);
    assertEditableStatus(answer.status, "answer sheet", "deleted");

    const uploadedFiles = collectUploadRefs(answer.answers);

    // Hard delete so a new answer sheet can be created for the same set.
    await answer.destroy({ force: true });
    await refreshExamStatus(answer.examId);
    cleanupUploadsInBackground(uploadedFiles, `deleting answer sheet ${answerId}`);

    return { answerId, examId: answer.examId, paperSet: answer.paperSet };
  }

  // ─────────────────────────────────────────────
  // APPROVAL — an answer sheet is reviewed together with its set's question
  // paper, so these delegate to the per-set workflow of that set only.
  // ─────────────────────────────────────────────

  private static async getAnswerOrFail(answerId: string) {
    const answer = await QuestionPaperAnswer.findOne({ where: { answerId } });
    if (!answer) throw new ApiError(httpStatus.NOT_FOUND, "Answer sheet not found");
    return answer;
  }

  static async submitForApproval(answerId: string, user: any) {
    const answer = await QuestionPaperAnswerService.getAnswerOrFail(answerId);
    await QuestionPaperService.submitSet(answer.examId, answer.paperSet, user);
    return answer.reload();
  }

  static async approveAnswer(answerId: string, reviewer: any) {
    const answer = await QuestionPaperAnswerService.getAnswerOrFail(answerId);
    await QuestionPaperService.approveSet(answer.examId, answer.paperSet, reviewer);
    return answer.reload();
  }

  static async rejectAnswer(answerId: string, reviewer: any, rejectionNote: string) {
    const answer = await QuestionPaperAnswerService.getAnswerOrFail(answerId);
    await QuestionPaperService.rejectSet(answer.examId, answer.paperSet, reviewer, rejectionNote);
    return answer.reload();
  }

  // PUBLISH  (APPROVED → PUBLISHED)
  static async publishAnswer(answerId: string) {
    const answer = await QuestionPaperAnswerService.getAnswerOrFail(answerId);
    if (answer.status !== "APPROVED") {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Cannot publish. Current status: ${answer.status}. Only APPROVED answer sheets can be published.`
      );
    }

    await answer.update({ status: "PUBLISHED", publishedAt: new Date() });

    try {
      await Notification.create({
        notificationId: await RegHelper.generateUserId(),
        instituteId: answer.instituteId,
        userId: answer.teacherId,
        type: "ANSWER_PUBLISHED",
        title: "Answer Sheet Published",
        message: "Your answer sheet has been published.",
        referenceId: answerId,
      });
    } catch (_) {
      // non-blocking
    }

    return answer;
  }



  // ─────────────────────────────────────────────
  // GET PENDING ANSWER SHEETS
  // ─────────────────────────────────────────────

  static async getPendingAnswers(instituteId: string) {
    const answers = await QuestionPaperAnswer.findAll({
      where: {
        instituteId,
        status: "PENDING_APPROVAL",
      },
      order: [["submittedAt", "DESC"]],
    });

    return answers;
  }

  // ─────────────────────────────────────────────
  // GET ALL ANSWER SHEETS WITH FILTERS
  // ─────────────────────────────────────────────

  static async getAnswers(
    instituteId: string,
    filters: { status?: string; examId?: string; teacherId?: string }
  ) {
    const where: any = { instituteId };

    if (filters.status) where.status = filters.status;
    if (filters.examId) where.examId = filters.examId;
    if (filters.teacherId) where.teacherId = filters.teacherId;

    const answers = await QuestionPaperAnswer.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return answers;
  }

}

export default QuestionPaperAnswerService;
