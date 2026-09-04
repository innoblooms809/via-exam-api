import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";
import Notification from "../../modals/Notification.modal";
import RegHelper from "../../utils/helper";

interface CreateQuestionPaperDTO {
  paperId?: string;
  instituteId?: string;
  examId: string;
  teacherId?: string;
  paperSet: "A" | "B" | "C" | "D";
  content: object;
}

export class QuestionPaperService {
  // ─────────────────────────────────────────────
  // CREATE QUESTION PAPER
  // ─────────────────────────────────────────────

  static async createQuestionPaper(
    data: CreateQuestionPaperDTO
  ) {
    const {
      instituteId,
      examId,
      teacherId,
      paperSet,
      content,
    } = data;

    if (!teacherId) {
      throw new Error("teacherId is required");
    }

    const exam = await Exam.findOne({
      where: { examId },
    });

    if (!exam) {
      throw new Error("Exam not found");
    }

    const resolvedInstituteId =
      instituteId || exam.instituteId;

    const existing = await QuestionPaper.findOne({
      where: { examId, paperSet },
    });

    if (existing) {
      throw new Error(
        `Question Paper Set ${paperSet} already exists for this exam`
      );
    }

    const resolvedPaperId =
      await RegHelper.generateUserId();

    const paper = await QuestionPaper.create({
      paperId: resolvedPaperId,
      instituteId: resolvedInstituteId,
      examId,
      teacherId,
      paperSet,
      content,
      status: "DRAFT",
    });

    return paper;
  }

  // ─────────────────────────────────────────────
  // SUBMIT FOR APPROVAL  (DRAFT → PENDING_APPROVAL)
  // ─────────────────────────────────────────────

  static async submitForApproval(
    paperId: string,
    teacherId: string
  ) {
    const paper = await QuestionPaper.findOne({
      where: { paperId },
    });

    if (!paper) {
      throw new Error("Question paper not found");
    }

    if (paper.teacherId !== teacherId) {
      throw new Error("You can only submit your own question paper");
    }

    if (paper.status !== "DRAFT" && paper.status !== "REJECTED") {
      throw new Error(
        `Cannot submit. Current status: ${paper.status}. Only DRAFT or REJECTED papers can be submitted for approval.`
      );
    }

    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    const matchingAnswer = await QuestionPaperAnswer.findOne({
      where: { examId: paper.examId, paperSet: paper.paperSet },
    });

    if (!matchingAnswer) {
      throw new Error(
        `Cannot submit for approval: Standard Answer Sheet for Set ${paper.paperSet} is missing. Please create the standard answer sheet first.`
      );
    }

    await paper.update({
      status: "PENDING_APPROVAL",
      submittedAt: new Date(),
    });

    // Also update the matching answer sheet to PENDING_APPROVAL if it's still in DRAFT
    if (matchingAnswer.status === "DRAFT" || matchingAnswer.status === "REJECTED") {
      await matchingAnswer.update({
        status: "PENDING_APPROVAL",
        submittedAt: new Date(),
      });
    }

    return paper;
  }

  // ─────────────────────────────────────────────
  // SUBMIT EXAM PAIR FOR APPROVAL (BY EXAM ID)
  // ─────────────────────────────────────────────

  static async submitExamForApproval(
    examId: string,
    teacherId: string
  ) {
    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    const paper = await QuestionPaper.findOne({
      where: { examId },
    });

    const answer = await QuestionPaperAnswer.findOne({
      where: { examId },
    });

    if (!paper && !answer) {
      throw new Error("Neither Question Paper nor Standard Answer Sheet has been created for this exam.");
    }

    if (!paper) {
      throw new Error("Question Paper is missing! Please create the question paper before submitting for approval.");
    }

    if (!answer) {
      throw new Error("Standard Answer Sheet is missing! Please create the standard answer sheet before submitting for approval.");
    }

    if (paper.status !== "DRAFT" && paper.status !== "REJECTED" && answer.status !== "DRAFT" && answer.status !== "REJECTED") {
      throw new Error(`Cannot submit. Current status: QP (${paper.status}), Answer (${answer.status}).`);
    }

    const now = new Date();
    await paper.update({
      status: "PENDING_APPROVAL",
      submittedAt: now,
    });

    await answer.update({
      status: "PENDING_APPROVAL",
      submittedAt: now,
    });

    return { paper, answer };
  }

  // ─────────────────────────────────────────────
  // APPROVE  (PENDING_APPROVAL → APPROVED)
  // ─────────────────────────────────────────────

  static async approvePaper(
    paperId: string,
    reviewerId: string
  ) {
    const paper = await QuestionPaper.findOne({
      where: { paperId },
    });

    if (!paper) {
      throw new Error("Question paper not found");
    }

    if (paper.status !== "PENDING_APPROVAL") {
      throw new Error(
        `Cannot approve. Current status: ${paper.status}. Only PENDING_APPROVAL papers can be approved.`
      );
    }

    await paper.update({
      status: "APPROVED",
      approvedAt: new Date(),
      rejectionNote: null,
    });

    // Notify the teacher
    const notificationId = await RegHelper.generateUserId();
    try {
      await Notification.create({
        notificationId,
        instituteId: paper.instituteId,
        userId: paper.teacherId,
        type: "PAPER_APPROVED",
        title: "Question Paper Approved",
        message: "Your question paper has been approved.",
        referenceId: paperId,
      });
    } catch (_) {
      // non-blocking
    }

    // Check if both QP and Answer are approved → set exam to Live
    await QuestionPaperService.checkAndSetExamLive(paper.examId);

    return paper;
  }

  // ─────────────────────────────────────────────
  // REJECT  (PENDING_APPROVAL → REJECTED)
  // ─────────────────────────────────────────────

  static async rejectPaper(
    paperId: string,
    reviewerId: string,
    rejectionNote: string
  ) {
    if (!rejectionNote || !rejectionNote.trim()) {
      throw new Error("Rejection note is required");
    }

    const paper = await QuestionPaper.findOne({
      where: { paperId },
    });

    if (!paper) {
      throw new Error("Question paper not found");
    }

    if (paper.status !== "PENDING_APPROVAL") {
      throw new Error(
        `Cannot reject. Current status: ${paper.status}. Only PENDING_APPROVAL papers can be rejected.`
      );
    }

    await paper.update({
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectionNote: rejectionNote.trim(),
    });

    // Notify the teacher
    const notificationId = await RegHelper.generateUserId();
    try {
      await Notification.create({
        notificationId,
        instituteId: paper.instituteId,
        userId: paper.teacherId,
        type: "PAPER_REJECTED",
        title: "Question Paper Rejected",
        message: `Your question paper has been rejected. Reason: ${rejectionNote.trim()}`,
        referenceId: paperId,
      });
    } catch (_) {
      // non-blocking
    }

    return paper;
  }

  // ─────────────────────────────────────────────
  // PUBLISH  (APPROVED → PUBLISHED)
  // ─────────────────────────────────────────────

  static async publishPaper(paperId: string) {
    const paper = await QuestionPaper.findOne({
      where: { paperId },
    });

    if (!paper) {
      throw new Error("Question paper not found");
    }

    if (paper.status !== "APPROVED") {
      throw new Error(
        `Cannot publish. Current status: ${paper.status}. Only APPROVED papers can be published.`
      );
    }

    await paper.update({
      status: "PUBLISHED",
      publishedAt: new Date(),
    });

    // Notify the teacher
    const notificationId = await RegHelper.generateUserId();
    try {
      await Notification.create({
        notificationId,
        instituteId: paper.instituteId,
        userId: paper.teacherId,
        type: "PAPER_PUBLISHED",
        title: "Question Paper Published",
        message: "Your question paper has been published.",
        referenceId: paperId,
      });
    } catch (_) {
      // non-blocking
    }

    return paper;
  }

  // ─────────────────────────────────────────────
  // GET PENDING PAPERS
  // ─────────────────────────────────────────────

  static async getPendingPapers(instituteId: string) {
    const papers = await QuestionPaper.findAll({
      where: {
        instituteId,
        status: "PENDING_APPROVAL",
      },
      order: [["submittedAt", "DESC"]],
    });

    return papers;
  }

  // ─────────────────────────────────────────────
  // GET ALL PAPERS WITH FILTERS
  // ─────────────────────────────────────────────

  static async getPapers(
    instituteId: string,
    filters: { status?: string; examId?: string; teacherId?: string }
  ) {
    const where: any = { instituteId };

    if (filters.status) where.status = filters.status;
    if (filters.examId) where.examId = filters.examId;
    if (filters.teacherId) where.teacherId = filters.teacherId;

    const papers = await QuestionPaper.findAll({
      where,
      order: [["createdAt", "DESC"]],
    });

    return papers;
  }

  // ─────────────────────────────────────────────
  // CHECK AND SET EXAM LIVE
  // ─────────────────────────────────────────────

  private static async checkAndSetExamLive(examId: string) {
    try {
      const QuestionPaperAnswer = (await import(
        "../../modals/question-paper/stander-answer.model"
      )).default;

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
      // non-blocking — exam status update is best-effort
    }
  }
}
