import QuestionPaper from "../../modals/question-paper/QuestionPaper.modal";
import Exam from "../../modals/Exam.modal";
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

    // ─────────────────────────────────────────────
    // Validate teacherId
    // ─────────────────────────────────────────────

    if (!teacherId) {
      throw new Error("teacherId is required");
    }

    // ─────────────────────────────────────────────
    // Find Exam
    // ─────────────────────────────────────────────

    const exam = await Exam.findOne({
      where: { examId },
    });

    if (!exam) {
      throw new Error("Exam not found");
    }

    // ─────────────────────────────────────────────
    // Resolve instituteId
    // ─────────────────────────────────────────────

    const resolvedInstituteId =
      instituteId || exam.instituteId;

    // ─────────────────────────────────────────────
    // Check Existing Paper Set
    // ─────────────────────────────────────────────

    const existing = await QuestionPaper.findOne({
      where: {
        examId,
        paperSet,
      },
    });

    if (existing) {
      throw new Error(
        `Question Paper Set ${paperSet} already exists for this exam`
      );
    }

    // ─────────────────────────────────────────────
    // Generate Paper ID
    // ─────────────────────────────────────────────

    const resolvedPaperId =
      await RegHelper.generateUserId();

    // ─────────────────────────────────────────────
    // Create Question Paper
    // ─────────────────────────────────────────────

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
}