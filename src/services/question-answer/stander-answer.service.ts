import QuestionPaperAnswer from "../../modals/question-paper/stander-answer.model";
import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";
import Notification from "../../modals/Notification.modal";
import RegHelper from "../../utils/helper";

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
        answers: data.answers,
        status: data.status || "DRAFT",
      });

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
      const existing = await QuestionPaperAnswer.findOne({
        where: {
          paperId: data.paperId,
          paperSet: data.paperSet,
        },
      });

      if (existing) {
        await existing.update({
          answers: { pdfUrl: data.pdfUrl },
          teacherId: data.teacherId,
          instituteId: data.instituteId,
          examId: data.examId,
        });
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
        return result;
      }
    } catch (error: any) {
      throw new Error(error.message);
    }
  }


  // ─────────────────────────────────────────────
  // SUBMIT FOR APPROVAL  (DRAFT → PENDING_APPROVAL)
  // ─────────────────────────────────────────────

  static async submitForApproval(
    answerId: string,
    teacherId: string
  ) {
    const answer = await QuestionPaperAnswer.findOne({
      where: { answerId },
    });

    if (!answer) {
      throw new Error("Answer sheet not found");
    }

    if (answer.teacherId !== teacherId) {
      throw new Error("You can only submit your own answer sheet");
    }

    if (answer.status !== "DRAFT" && answer.status !== "REJECTED") {
      throw new Error(
        `Cannot submit. Current status: ${answer.status}. Only DRAFT or REJECTED answer sheets can be submitted for approval.`
      );
    }

    const matchingPaper = await QuestionPaper.findOne({
      where: { examId: answer.examId, paperSet: answer.paperSet },
    });

    if (!matchingPaper) {
      throw new Error(
        `Cannot submit for approval: Question Paper for Set ${answer.paperSet} is missing. Please create the question paper first.`
      );
    }

    await answer.update({
      status: "PENDING_APPROVAL",
      submittedAt: new Date(),
    });

    // Also update matching question paper if DRAFT or REJECTED
    if (matchingPaper.status === "DRAFT" || matchingPaper.status === "REJECTED") {
      await matchingPaper.update({
        status: "PENDING_APPROVAL",
        submittedAt: new Date(),
      });
    }

    return answer;
  }

  // ─────────────────────────────────────────────
  // APPROVE  (PENDING_APPROVAL → APPROVED)
  // ─────────────────────────────────────────────

  static async approveAnswer(
    answerId: string,
    reviewerId: string
  ) {
    const answer = await QuestionPaperAnswer.findOne({
      where: { answerId },
    });

    if (!answer) {
      throw new Error("Answer sheet not found");
    }

    if (answer.status !== "PENDING_APPROVAL") {
      throw new Error(
        `Cannot approve. Current status: ${answer.status}. Only PENDING_APPROVAL answer sheets can be approved.`
      );
    }

    await answer.update({
      status: "APPROVED",
      approvedAt: new Date(),
      rejectionNote: null,
    });

    // Notify the teacher
    const notificationId = await RegHelper.generateUserId();
    try {
      await Notification.create({
        notificationId,
        instituteId: answer.instituteId,
        userId: answer.teacherId,
        type: "ANSWER_APPROVED",
        title: "Answer Sheet Approved",
        message: "Your answer sheet has been approved.",
        referenceId: answerId,
      });
    } catch (_) {
      // non-blocking
    }

    // Check if both QP and Answer are approved → set exam to Live
    await QuestionPaperAnswerService.checkAndSetExamLive(answer.examId);

    return answer;
  }

  // ─────────────────────────────────────────────
  // REJECT  (PENDING_APPROVAL → REJECTED)
  // ─────────────────────────────────────────────

  static async rejectAnswer(
    answerId: string,
    reviewerId: string,
    rejectionNote: string
  ) {
    if (!rejectionNote || !rejectionNote.trim()) {
      throw new Error("Rejection note is required");
    }

    const answer = await QuestionPaperAnswer.findOne({
      where: { answerId },
    });

    if (!answer) {
      throw new Error("Answer sheet not found");
    }

    if (answer.status !== "PENDING_APPROVAL") {
      throw new Error(
        `Cannot reject. Current status: ${answer.status}. Only PENDING_APPROVAL answer sheets can be rejected.`
      );
    }

    await answer.update({
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionNote: rejectionNote.trim(),
    });

    // Notify the teacher
    const notificationId = await RegHelper.generateUserId();
    try {
      await Notification.create({
        notificationId,
        instituteId: answer.instituteId,
        userId: answer.teacherId,
        type: "ANSWER_REJECTED",
        title: "Answer Sheet Rejected",
        message: `Your answer sheet has been rejected. Reason: ${rejectionNote.trim()}`,
        referenceId: answerId,
      });
    } catch (_) {
      // non-blocking
    }

    return answer;
  }

  // ─────────────────────────────────────────────
  // PUBLISH  (APPROVED → PUBLISHED)
  // ─────────────────────────────────────────────

  static async publishAnswer(answerId: string) {
    const answer = await QuestionPaperAnswer.findOne({
      where: { answerId },
    });

    if (!answer) {
      throw new Error("Answer sheet not found");
    }

    if (answer.status !== "APPROVED") {
      throw new Error(
        `Cannot publish. Current status: ${answer.status}. Only APPROVED answer sheets can be published.`
      );
    }

    await answer.update({
      status: "PUBLISHED",
      publishedAt: new Date(),
    });

    // Notify the teacher
    const notificationId = await RegHelper.generateUserId();
    try {
      await Notification.create({
        notificationId,
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

  // ─────────────────────────────────────────────
  // CHECK AND SET EXAM LIVE
  // ─────────────────────────────────────────────

  private static async checkAndSetExamLive(examId: string) {
    try {
      const [qp, ans] = await Promise.all([
        QuestionPaper.findOne({ where: { examId, status: "APPROVED" } }),
        QuestionPaperAnswer.findOne({ where: { examId, status: "APPROVED" } }),
      ]);

      if (qp && ans) {
        await Exam.update(
          { status: "Live" },
          { where: { examId } }
        );
      }
    } catch (_) {
      // non-blocking
    }
  }
}

export default QuestionPaperAnswerService;
