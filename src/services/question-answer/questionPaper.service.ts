import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";
import Notification from "../../modals/Notification.modal";
import RegHelper from "../../utils/helper";
import { Op } from "sequelize";
import {
  markExamPaperCreated,
  setExamWorkflowStatus,
} from "../exam.service";

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

    await markExamPaperCreated(examId);

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

    await setExamWorkflowStatus(paper.examId, "Pending Approval");

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

    const answerWhere: any = paper
      ? { [Op.or]: [{ examId }, { paperId: paper.paperId }] }
      : { examId };

    const answer = await QuestionPaperAnswer.findOne({
      where: answerWhere,
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

    const now = new Date();

    if (paper.status === "DRAFT" || paper.status === "REJECTED") {
      await paper.update({
        status: "PENDING_APPROVAL",
        submittedAt: now,
      });
    }

    if (answer.status === "DRAFT" || answer.status === "REJECTED") {
      await answer.update({
        status: "PENDING_APPROVAL",
        submittedAt: now,
      });
    }

    await setExamWorkflowStatus(examId, "Pending Approval");

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

    // Check if both QP and Answer are approved → set exam to Approved
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

    await setExamWorkflowStatus(paper.examId, "Rejected");

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
  // APPROVE EXAM PAIR (QP + ANSWER SHEET)
  // ─────────────────────────────────────────────

  static async approveExamPair(examId: string, reviewerId: string) {
    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    const paper = await QuestionPaper.findOne({ where: { examId } });
    const answer = await QuestionPaperAnswer.findOne({
      where: paper
        ? { [Op.or]: [{ examId }, { paperId: paper.paperId }] }
        : { examId },
    });

    if (!paper && !answer) {
      throw new Error("No question paper or answer sheet found for this exam.");
    }

    const now = new Date();
    if (paper) {
      await paper.update({
        status: "APPROVED",
        approvedAt: now,
        rejectionNote: null,
      });
    }

    if (answer) {
      await answer.update({
        status: "APPROVED",
        approvedAt: now,
        rejectionNote: null,
        examId,
      });
    }

    await setExamWorkflowStatus(examId, "Approved");

    return { paper, answer };
  }

  // ─────────────────────────────────────────────
  // REJECT EXAM PAIR (QP + ANSWER SHEET)
  // ─────────────────────────────────────────────

  static async rejectExamPair(examId: string, reviewerId: string, rejectionNote: string) {
    if (!rejectionNote || !rejectionNote.trim()) {
      throw new Error("Rejection note is required.");
    }

    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    const paper = await QuestionPaper.findOne({ where: { examId } });
    const answer = await QuestionPaperAnswer.findOne({
      where: paper
        ? { [Op.or]: [{ examId }, { paperId: paper.paperId }] }
        : { examId },
    });

    if (!paper && !answer) {
      throw new Error("No question paper or answer sheet found for this exam.");
    }

    const now = new Date();
    const note = rejectionNote.trim();

    if (paper) {
      await paper.update({
        status: "REJECTED",
        rejectedAt: now,
        rejectionNote: note,
      });
    }

    if (answer) {
      await answer.update({
        status: "REJECTED",
        rejectedAt: now,
        rejectionNote: note,
      });
    }

    await setExamWorkflowStatus(examId, "Rejected");

    return { paper, answer };
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
        await setExamWorkflowStatus(examId, "Approved");
      }
    } catch (_) {
      // non-blocking — exam status update is best-effort
    }
  }

  // ─────────────────────────────────────────────
  // GET EXAM REMARKS (CHAT HISTORY)
  // ─────────────────────────────────────────────

  static async getExamRemarks(examId: string) {
    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    const paper = await QuestionPaper.findOne({ where: { examId } });
    const answer = await QuestionPaperAnswer.findOne({
      where: paper
        ? { [Op.or]: [{ examId }, { paperId: paper.paperId }] }
        : { examId },
    });

    // Pick whichever has a rejectionNote
    const noteSource = paper?.rejectionNote
      ? paper.rejectionNote
      : answer?.rejectionNote || null;

    let remarks: any[] = [];
    if (noteSource) {
      try {
        const parsed = JSON.parse(noteSource);
        if (Array.isArray(parsed)) {
          remarks = parsed;
        } else {
          remarks = [
            {
              sender: "Admin Reviewer",
              role: "ADMIN",
              text: noteSource,
              time: (paper as any)?.rejectedAt || (answer as any)?.rejectedAt || new Date().toISOString(),
            },
          ];
        }
      } catch {
        remarks = [
          {
            sender: "Admin Reviewer",
            role: "ADMIN",
            text: noteSource,
            time: (paper as any)?.rejectedAt || (answer as any)?.rejectedAt || new Date().toISOString(),
          },
        ];
      }
    }

    return { remarks };
  }

  // ─────────────────────────────────────────────
  // ADD EXAM REMARK (CHAT MESSAGE)
  // ─────────────────────────────────────────────

  static async addExamRemark(
    examId: string,
    remark: string,
    senderRole: string = "ADMIN",
    senderName: string = "Admin Reviewer"
  ) {
    if (!remark || !remark.trim()) {
      throw new Error("Remark text is required.");
    }

    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    let paper = await QuestionPaper.findOne({ where: { examId } });
    let answer = await QuestionPaperAnswer.findOne({
      where: paper
        ? { [Op.or]: [{ examId }, { paperId: paper.paperId }] }
        : { examId },
    });

    if (!paper && !answer) {
      const exam = await Exam.findOne({ where: { examId } });
      const paperId = await RegHelper.generateUserId();
      paper = await QuestionPaper.create({
        paperId,
        instituteId: exam?.instituteId || "INST001",
        examId,
        teacherId: exam?.teacherId || "TECH001",
        paperSet: "A",
        content: {},
        status: "REJECTED",
      });
    }

    // Parse existing remarks from whichever source has them
    const noteSource = paper?.rejectionNote
      ? paper.rejectionNote
      : answer?.rejectionNote || null;

    let remarks: any[] = [];
    if (noteSource) {
      try {
        const parsed = JSON.parse(noteSource);
        if (Array.isArray(parsed)) {
          remarks = parsed;
        } else {
          remarks = [
            {
              sender: "Admin Reviewer",
              role: "ADMIN",
              text: noteSource,
              time: (paper as any)?.rejectedAt || (answer as any)?.rejectedAt || new Date().toISOString(),
            },
          ];
        }
      } catch {
        remarks = [
          {
            sender: "Admin Reviewer",
            role: "ADMIN",
            text: noteSource,
            time: (paper as any)?.rejectedAt || (answer as any)?.rejectedAt || new Date().toISOString(),
          },
        ];
      }
    }

    // Append new remark
    remarks.push({
      sender: senderName,
      role: senderRole,
      text: remark.trim(),
      time: new Date().toISOString(),
    });

    const serialized = JSON.stringify(remarks);

    // Persist on both models if they exist
    if (paper) {
      await paper.update({ rejectionNote: serialized });
    }
    if (answer) {
      await answer.update({ rejectionNote: serialized });
    }

    return { remarks };
  }
}

