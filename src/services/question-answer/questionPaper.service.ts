import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";
import Notification from "../../modals/Notification.modal";
import RegHelper from "../../utils/helper";
import ApiError from "../../utils/ApiError";
import { sequelize } from "../../config/sequelize";
import httpStatus from "http-status";
import { Op } from "sequelize";
import {
  markExamPaperCreated,
  refreshExamStatus,
} from "../exam.service";
import { cleanupUploadsInBackground, collectUploadRefs } from "../uploadedFiles.service";
import { countUnlinkedAnswers, reconcileTypedAnswers } from "../../utils/answerSheetReconcile";
import logger from "../../config/logger";

/** What happened to the set's typed answers when its paper changed. */
export interface AnswerSheetLinkSummary {
  answerId: string;
  relinked: number;
  unlinked: number;
}

interface CreateQuestionPaperDTO {
  paperId?: string;
  instituteId?: string;
  examId: string;
  teacherId?: string;
  paperSet: "A" | "B" | "C" | "D";
  content: object;
}

type PaperSet = "A" | "B" | "C" | "D";
const PAPER_SETS: PaperSet[] = ["A", "B", "C", "D"];

// Papers/answer sheets can only be changed before review starts, or after a
// rejection — once pending/approved/published they are locked for the approval flow.
export const EDITABLE_PACKAGE_STATUSES = ["DRAFT", "REJECTED"];

const STATUS_LABELS: Record<string, string> = {
  PENDING_APPROVAL: "pending approval",
  APPROVED: "approved",
  PUBLISHED: "published",
};

export const isTeacherUser = (user: any): boolean =>
  String(user?.role?.role ?? user?.role ?? "").toUpperCase().includes("TEACH");

export const assertEditableStatus = (
  status: string,
  what: "question paper" | "answer sheet",
  action: "edited" | "deleted" | "replaced"
) => {
  if (!EDITABLE_PACKAGE_STATUSES.includes(status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This ${what} is ${STATUS_LABELS[status] ?? status.toLowerCase()} and can no longer be ${action}. Only draft or rejected ${what}s can be ${action}.`
    );
  }
};

export const normalizePaperSet = (value: unknown): PaperSet | null => {
  const letter = String(value ?? "").trim().toUpperCase().match(/[A-D]$/)?.[0] as PaperSet | undefined;
  return letter && PAPER_SETS.includes(letter) ? letter : null;
};

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

    // Deleting a paper deletes its answer sheet, so normally there is nothing here.
    // An answer sheet left over for this set from older data is linked to the new
    // paper (and its typed answers re-linked) instead of being silently ignored.
    const answerSheet = await QuestionPaperService.relinkAnswerSheet(examId, paperSet, resolvedPaperId, content);

    await markExamPaperCreated(examId);

    return { paper, answerSheet };
  }

  /**
   * Points a left-over answer sheet of the set (if any) at the set's new paper and
   * re-links its typed answers to the new questions (see answerSheetReconcile). The
   * new paper is a draft, so that answer sheet goes back to draft too — the set must
   * be reviewed again as a whole.
   */
  private static async relinkAnswerSheet(
    examId: string,
    paperSet: PaperSet,
    paperId: string,
    content: unknown
  ): Promise<AnswerSheetLinkSummary | null> {
    try {
      const QuestionPaperAnswer = (await import(
        "../../modals/question-paper/stander-answer.model"
      )).default;
      const kept = await QuestionPaperAnswer.findOne({
        where: { examId, paperSet, paperId: { [Op.ne]: paperId } },
        order: [["updatedAt", "DESC"]],
      });
      if (!kept) return null;

      const reconciled = reconcileTypedAnswers(kept.answers, null, content);
      const updates: Record<string, unknown> = { paperId };
      if (reconciled?.changed) updates.answers = reconciled.answers;
      if (!EDITABLE_PACKAGE_STATUSES.includes(kept.status)) {
        Object.assign(updates, { status: "DRAFT", submittedAt: null, approvedAt: null, rejectedAt: null, publishedAt: null });
      }
      await kept.update(updates);

      logger.info(
        `[QuestionPaper] Linked kept answer sheet ${kept.answerId} to new paper ${paperId} (Set ${paperSet}); ` +
          `re-linked ${reconciled?.relinked ?? 0}, unlinked ${reconciled?.unlinked ?? 0}.`
      );
      return { answerId: kept.answerId, relinked: reconciled?.relinked ?? 0, unlinked: reconciled?.unlinked ?? 0 };
    } catch (err: any) {
      logger.warn(`[QuestionPaper] Could not link the kept answer sheet of Set ${paperSet}: ${err?.message || err}`);
      return null;
    }
  }

  /**
   * After the paper's questions changed: re-link the set's typed answers to the
   * current questions. Locked (pending / approved) answer sheets are left untouched.
   */
  private static async reconcileSetAnswers(
    paperId: string,
    oldContent: unknown,
    newContent: unknown
  ): Promise<AnswerSheetLinkSummary | null> {
    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;
    const answer = await QuestionPaperAnswer.findOne({ where: { paperId } });
    if (!answer || !EDITABLE_PACKAGE_STATUSES.includes(answer.status)) return null;

    const reconciled = reconcileTypedAnswers(answer.answers, oldContent, newContent);
    if (!reconciled) return null;
    if (reconciled.changed) await answer.update({ answers: reconciled.answers });
    return { answerId: answer.answerId, relinked: reconciled.relinked, unlinked: reconciled.unlinked };
  }

  // ─────────────────────────────────────────────
  // FIND A PAPER THE USER MAY CHANGE
  // ─────────────────────────────────────────────

  static async findPaperForUser(paperId: string, user: any) {
    const paper = await QuestionPaper.findOne({ where: { paperId } });

    if (!paper || (user?.instituteId && paper.instituteId !== user.instituteId)) {
      throw new ApiError(httpStatus.NOT_FOUND, "Question paper not found");
    }

    if (isTeacherUser(user) && paper.teacherId !== user.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, "You can only change your own question paper");
    }

    return paper;
  }

  // ─────────────────────────────────────────────
  // UPDATE QUESTION PAPER  (DRAFT / REJECTED only)
  // ─────────────────────────────────────────────

  static async updateQuestionPaper(
    paperId: string,
    user: any,
    data: { content?: unknown; paperSet?: unknown }
  ) {
    const paper = await QuestionPaperService.findPaperForUser(paperId, user);
    assertEditableStatus(paper.status, "question paper", "edited");

    const updates: { content?: object; paperSet?: PaperSet } = {};

    if (data.content !== undefined) {
      if (!data.content || typeof data.content !== "object" || Array.isArray(data.content)) {
        throw new ApiError(httpStatus.BAD_REQUEST, "content must be an object");
      }
      updates.content = data.content as object;
    }

    if (data.paperSet !== undefined) {
      const paperSet = normalizePaperSet(data.paperSet);
      if (!paperSet) {
        throw new ApiError(httpStatus.BAD_REQUEST, "paperSet must be one of A, B, C or D");
      }
      if (paperSet !== paper.paperSet) {
        const clash = await QuestionPaper.findOne({
          where: { examId: paper.examId, paperSet, paperId: { [Op.ne]: paperId } },
        });
        if (clash) {
          throw new ApiError(
            httpStatus.CONFLICT,
            `A question paper for Set ${paperSet} already exists for this exam. Please choose a different Set.`
          );
        }
        updates.paperSet = paperSet;
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Nothing to update");
    }

    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    const oldContent = paper.content;
    const filesBefore = updates.content ? collectUploadRefs(oldContent) : [];

    await sequelize.transaction(async (transaction) => {
      await paper.update(updates, { transaction });

      // The answer sheet belongs to the paper's set — keep it on the same set.
      if (updates.paperSet) {
        await QuestionPaperAnswer.update(
          { paperSet: updates.paperSet },
          { where: { paperId }, transaction }
        );
      }
    });

    // Questions may have been removed / re-added: keep the typed answers linked.
    const answerSheet = updates.content
      ? await QuestionPaperService.reconcileSetAnswers(paperId, oldContent, updates.content)
      : null;

    // Diagrams / logo the teacher removed or replaced are no longer needed.
    cleanupUploadsInBackground(filesBefore, `editing question paper ${paperId}`);

    return { paper, answerSheet };
  }

  // ─────────────────────────────────────────────
  // DELETE QUESTION PAPER — and its answer sheet
  // The answer sheet depends on the paper (its answers belong to the paper's
  // questions), so deleting a paper deletes the set's answer sheet with it, in one
  // transaction. Deleting an answer sheet on its own never touches the paper
  // (see QuestionPaperAnswerService.deleteQuestionPaperAnswer).
  // Both only while DRAFT / REJECTED; their uploaded files are removed afterwards.
  // ─────────────────────────────────────────────

  static async deleteQuestionPaper(paperId: string, user: any) {
    const paper = await QuestionPaperService.findPaperForUser(paperId, user);
    assertEditableStatus(paper.status, "question paper", "deleted");

    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    // The set's answer sheet(s): linked by paper id, or by exam + set for older rows.
    const answerWhere = {
      [Op.or]: [{ paperId }, { examId: paper.examId, paperSet: paper.paperSet }],
    };
    const answers = await QuestionPaperAnswer.findAll({ where: answerWhere });
    // A locked (pending / approved) answer sheet blocks the whole delete — nothing is removed.
    answers.forEach((answer) => assertEditableStatus(answer.status, "answer sheet", "deleted"));

    const uploadedFiles = [
      ...collectUploadRefs(paper.content),
      ...answers.flatMap((answer) => collectUploadRefs(answer.answers)),
    ];

    // Hard delete: the unique (exam, set) / (paper, set) indexes would otherwise keep
    // blocking a new paper or answer sheet for the same set after a soft delete.
    await sequelize.transaction(async (transaction) => {
      await QuestionPaperAnswer.destroy({ where: answerWhere, force: true, transaction });
      await paper.destroy({ force: true, transaction });
    });

    await refreshExamStatus(paper.examId);
    cleanupUploadsInBackground(uploadedFiles, `deleting question paper ${paperId}`);

    return {
      paperId,
      examId: paper.examId,
      paperSet: paper.paperSet,
      deletedAnswerSheets: answers.length,
    };
  }

  // ─────────────────────────────────────────────
  // APPROVAL WORKFLOW — PER SET
  // A set = one exam's question paper + its answer sheet (same paperSet).
  // Each set is submitted / approved / rejected on its own; the exam status is
  // then recomputed from all of its sets (see refreshExamStatus).
  // ─────────────────────────────────────────────

  static requireSetLetter(paperSet: unknown): PaperSet {
    const set = normalizePaperSet(paperSet);
    if (!set) throw new ApiError(httpStatus.BAD_REQUEST, "paperSet must be one of A, B, C or D");
    return set;
  }

  /** The question paper and answer sheet of one set of an exam. */
  static async findSet(examId: string, paperSet: PaperSet) {
    const QuestionPaperAnswer = (await import(
      "../../modals/question-paper/stander-answer.model"
    )).default;

    const paper = await QuestionPaper.findOne({ where: { examId, paperSet } });
    const answer = await QuestionPaperAnswer.findOne({
      where: paper
        ? { [Op.or]: [{ paperId: paper.paperId }, { examId, paperSet }] }
        : { examId, paperSet },
    });

    return { paper, answer };
  }

  private static assertSameInstitute(paper: QuestionPaper, user: any) {
    if (user?.instituteId && paper.instituteId !== user.instituteId) {
      throw new ApiError(httpStatus.NOT_FOUND, "Question paper not found");
    }
  }

  private static async notifyTeacher(paper: QuestionPaper, type: string, title: string, message: string) {
    try {
      await Notification.create({
        notificationId: await RegHelper.generateUserId(),
        instituteId: paper.instituteId,
        userId: paper.teacherId,
        type,
        title,
        message,
        referenceId: paper.paperId,
      });
    } catch (_) {
      // non-blocking
    }
  }

  // SUBMIT ONE SET  (DRAFT / REJECTED → PENDING_APPROVAL)
  static async submitSet(examId: string, paperSet: PaperSet, user: any) {
    const { paper, answer } = await QuestionPaperService.findSet(examId, paperSet);

    if (!paper) {
      throw new ApiError(httpStatus.NOT_FOUND, `Question paper for Set ${paperSet} is missing. Please create it first.`);
    }
    QuestionPaperService.assertSameInstitute(paper, user);
    if (isTeacherUser(user) && paper.teacherId !== user.userId) {
      throw new ApiError(httpStatus.FORBIDDEN, "You can only submit your own question paper");
    }
    if (!answer) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Standard answer sheet for Set ${paperSet} is missing. Please create it before submitting Set ${paperSet} for approval.`
      );
    }
    if (!EDITABLE_PACKAGE_STATUSES.includes(paper.status) || !EDITABLE_PACKAGE_STATUSES.includes(answer.status)) {
      const current = EDITABLE_PACKAGE_STATUSES.includes(paper.status) ? answer.status : paper.status;
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Set ${paperSet} is already ${STATUS_LABELS[current] ?? current.toLowerCase()}. Only draft or rejected sets can be submitted.`
      );
    }
    // Never send a mismatched answer key for review.
    const unlinked = countUnlinkedAnswers(answer.answers, paper.content);
    if (unlinked > 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `${unlinked} answer(s) in the Set ${paperSet} answer sheet are not linked to any question of the current paper. ` +
          "Open the answer sheet to link or discard them before submitting."
      );
    }

    const now = new Date();
    await sequelize.transaction(async (transaction) => {
      await paper.update({ status: "PENDING_APPROVAL", submittedAt: now }, { transaction });
      await answer.update({ status: "PENDING_APPROVAL", submittedAt: now, examId }, { transaction });
    });

    await refreshExamStatus(examId);
    return { paperSet, paper, answer };
  }

  // APPROVE ONE SET  (PENDING_APPROVAL → APPROVED)
  static async approveSet(examId: string, paperSet: PaperSet, reviewer: any) {
    const { paper, answer } = await QuestionPaperService.findSet(examId, paperSet);

    if (!paper) throw new ApiError(httpStatus.NOT_FOUND, `Question paper for Set ${paperSet} not found`);
    QuestionPaperService.assertSameInstitute(paper, reviewer);
    if (paper.status !== "PENDING_APPROVAL") {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Set ${paperSet} has not been submitted for approval (current status: ${paper.status}).`
      );
    }

    const now = new Date();
    await sequelize.transaction(async (transaction) => {
      await paper.update({ status: "APPROVED", approvedAt: now, rejectionNote: null }, { transaction });
      if (answer) {
        await answer.update({ status: "APPROVED", approvedAt: now, rejectionNote: null, examId }, { transaction });
      }
    });

    await QuestionPaperService.notifyTeacher(
      paper,
      "PAPER_APPROVED",
      "Question Paper Approved",
      `Your question paper and answer sheet for Set ${paperSet} have been approved.`
    );
    await refreshExamStatus(examId);
    return { paperSet, paper, answer };
  }

  // REJECT ONE SET  (PENDING_APPROVAL → REJECTED)
  static async rejectSet(examId: string, paperSet: PaperSet, reviewer: any, rejectionNote: string) {
    const note = String(rejectionNote ?? "").trim();
    if (!note) throw new ApiError(httpStatus.BAD_REQUEST, "Rejection note is required");

    const { paper, answer } = await QuestionPaperService.findSet(examId, paperSet);

    if (!paper) throw new ApiError(httpStatus.NOT_FOUND, `Question paper for Set ${paperSet} not found`);
    QuestionPaperService.assertSameInstitute(paper, reviewer);
    if (paper.status !== "PENDING_APPROVAL") {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Set ${paperSet} has not been submitted for approval (current status: ${paper.status}).`
      );
    }

    const now = new Date();
    await sequelize.transaction(async (transaction) => {
      await paper.update({ status: "REJECTED", rejectedAt: now, rejectionNote: note }, { transaction });
      if (answer) {
        await answer.update({ status: "REJECTED", rejectedAt: now, rejectionNote: note }, { transaction });
      }
    });

    await QuestionPaperService.notifyTeacher(
      paper,
      "PAPER_REJECTED",
      "Question Paper Rejected",
      `Set ${paperSet} was rejected. Reason: ${note}`
    );
    await refreshExamStatus(examId);
    return { paperSet, paper, answer };
  }

  // ── Exam-level endpoints (kept for existing callers) ────────────────────────
  // With a paperSet they act on that set only. Without one they act only on the
  // sets that qualify — never on a set that was not submitted.

  static async submitExamForApproval(examId: string, user: any, paperSet?: unknown) {
    if (paperSet) {
      const result = await QuestionPaperService.submitSet(examId, QuestionPaperService.requireSetLetter(paperSet), user);
      return { submitted: [result.paperSet], skipped: [] as string[] };
    }

    const papers = await QuestionPaper.findAll({ where: { examId }, order: [["paperSet", "ASC"]] });
    if (papers.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Question Paper is missing! Please create the question paper before submitting for approval.");
    }

    const ready: PaperSet[] = [];
    const missingAnswer: PaperSet[] = [];
    for (const p of papers) {
      if (!EDITABLE_PACKAGE_STATUSES.includes(p.status)) continue;
      const { answer } = await QuestionPaperService.findSet(examId, p.paperSet);
      if (answer && EDITABLE_PACKAGE_STATUSES.includes(answer.status)) ready.push(p.paperSet);
      else if (!answer) missingAnswer.push(p.paperSet);
    }

    if (ready.length === 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        missingAnswer.length
          ? `Standard answer sheet is missing for Set ${missingAnswer.join(", ")}. Create it before submitting.`
          : "No draft or rejected set of this exam is ready to submit."
      );
    }

    for (const set of ready) {
      await QuestionPaperService.submitSet(examId, set, user);
    }
    return { submitted: ready, skipped: missingAnswer };
  }

  static async approveExamPair(examId: string, reviewer: any, paperSet?: unknown) {
    const sets = paperSet
      ? [QuestionPaperService.requireSetLetter(paperSet)]
      : (await QuestionPaper.findAll({ where: { examId, status: "PENDING_APPROVAL" } })).map((p) => p.paperSet);

    if (sets.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "No set of this exam is pending approval.");
    }
    for (const set of sets) {
      await QuestionPaperService.approveSet(examId, set, reviewer);
    }
    return { approved: sets };
  }

  static async rejectExamPair(examId: string, reviewer: any, rejectionNote: string, paperSet?: unknown) {
    const sets = paperSet
      ? [QuestionPaperService.requireSetLetter(paperSet)]
      : (await QuestionPaper.findAll({ where: { examId, status: "PENDING_APPROVAL" } })).map((p) => p.paperSet);

    if (sets.length === 0) {
      throw new ApiError(httpStatus.BAD_REQUEST, "No set of this exam is pending approval.");
    }
    for (const set of sets) {
      await QuestionPaperService.rejectSet(examId, set, reviewer, rejectionNote);
    }
    return { rejected: sets };
  }

  // ── Per-paper endpoints — act on the paper's set ───────────────────────────

  private static async getPaperOrFail(paperId: string) {
    const paper = await QuestionPaper.findOne({ where: { paperId } });
    if (!paper) throw new ApiError(httpStatus.NOT_FOUND, "Question paper not found");
    return paper;
  }

  static async submitForApproval(paperId: string, user: any) {
    const paper = await QuestionPaperService.getPaperOrFail(paperId);
    const { paper: updated } = await QuestionPaperService.submitSet(paper.examId, paper.paperSet, user);
    return updated;
  }

  static async approvePaper(paperId: string, reviewer: any) {
    const paper = await QuestionPaperService.getPaperOrFail(paperId);
    const { paper: updated } = await QuestionPaperService.approveSet(paper.examId, paper.paperSet, reviewer);
    return updated;
  }

  static async rejectPaper(paperId: string, reviewer: any, rejectionNote: string) {
    const paper = await QuestionPaperService.getPaperOrFail(paperId);
    const { paper: updated } = await QuestionPaperService.rejectSet(paper.examId, paper.paperSet, reviewer, rejectionNote);
    return updated;
  }

  // PUBLISH  (APPROVED → PUBLISHED) — the set's answer sheet goes with it.
  static async publishPaper(paperId: string) {
    const paper = await QuestionPaperService.getPaperOrFail(paperId);
    if (paper.status !== "APPROVED") {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Cannot publish. Current status: ${paper.status}. Only APPROVED papers can be published.`
      );
    }

    const { answer } = await QuestionPaperService.findSet(paper.examId, paper.paperSet);
    const now = new Date();
    await paper.update({ status: "PUBLISHED", publishedAt: now });
    if (answer && answer.status === "APPROVED") {
      await answer.update({ status: "PUBLISHED", publishedAt: now });
    }

    await QuestionPaperService.notifyTeacher(paper, "PAPER_PUBLISHED", "Question Paper Published", "Your question paper has been published.");
    await refreshExamStatus(paper.examId);
    return paper;
  }

  // ─────────────────────────────────────────────
  // LISTS
  // ─────────────────────────────────────────────

  static async getPendingPapers(instituteId: string) {
    return QuestionPaper.findAll({
      where: { instituteId, status: "PENDING_APPROVAL" },
      order: [["submittedAt", "DESC"]],
    });
  }

  static async getPapers(
    instituteId: string,
    filters: { status?: string; examId?: string; teacherId?: string }
  ) {
    const where: any = { instituteId };
    if (filters.status) where.status = filters.status;
    if (filters.examId) where.examId = filters.examId;
    if (filters.teacherId) where.teacherId = filters.teacherId;

    return QuestionPaper.findAll({ where, order: [["createdAt", "DESC"]] });
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
      // Remarks are stored on the exam's paper/answer sheet. Creating a placeholder
      // paper here used to add a fake, rejected "Set A" to the exam.
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Remarks can be added once a question paper or answer sheet exists for this exam."
      );
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

