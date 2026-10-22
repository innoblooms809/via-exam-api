import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// A student's recheck claim on one published result (one per exam, ever): what kind of
// marking concern it is (category), the questions it is about (none: the whole paper),
// the student's own words (reason), and the words of the final decision (decisionNote:
// the admin's reason when it is turned down, the evaluator's remark when it is completed).

/** What a student can claim, in the order the claim form lists them. */
export const RECHECK_CATEGORIES = [
  { key: "MARKS_NOT_AWARDED", label: "Marks not awarded for a correct answer" },
  { key: "MARKING_SCHEME", label: "Incorrect application of the marking scheme" },
  { key: "OCR_MAPPING", label: "OCR or answer-mapping error" },
  { key: "TOTALING", label: "Incorrect total or score aggregation" },
  { key: "NOT_EVALUATED", label: "Question not evaluated" },
  { key: "OTHER", label: "Other permitted examination-related concerns" },
] as const;

export type RecheckCategory = (typeof RECHECK_CATEGORIES)[number]["key"];

export const recheckCategoryLabel = (key: string | null | undefined) => RECHECK_CATEGORIES.find((c) => c.key === key)?.label ?? null;

/**
 * Where a claim is:
 *   Pending            the exam office hasn't decided what to do with it yet
 *   Under Review       an evaluator is rechecking the sheet (or redoing it after a send-back)
 *   Awaiting Approval  the evaluator decided; the admin approves before the result changes
 *   Completed          the decision is approved and published (the result shows it)
 *   Rejected           the exam office turned the claim down
 * "Approved" is an old value no step writes any more.
 */
export type RecheckStatus = "Pending" | "Under Review" | "Awaiting Approval" | "Approved" | "Rejected" | "Completed";

/** Claims not decided yet (the exam can't be unpublished while one is open). */
export const RECHECK_OPEN_STATUSES: RecheckStatus[] = ["Pending", "Under Review", "Awaiting Approval", "Approved"];

/** A question the claim is about, as the evaluation numbered it when the claim was made. */
export interface ClaimedQuestion {
  /** The question's key in the evaluation (see questionsOf in examWorkflow.service). */
  questionId: string;
  /** "Q3(b)" */
  label: string;
  /** Marks awarded and the maximum when the claim was made. */
  obtained: number | null;
  maximum: number | null;
}

interface RecheckRequestAttributes {
  id: number;
  requestId: string;
  studentId: string;
  instituteId: string;
  examId: string;
  evaluationId: string;
  subjectId: string;
  category: RecheckCategory | null;
  questions: ClaimedQuestion[] | null;
  reason: string | null;
  decisionNote: string | null;
  status: RecheckStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  completedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface RecheckRequestCreationAttributes
  extends Optional<
    RecheckRequestAttributes,
    | "id"
    | "requestId"
    | "category"
    | "questions"
    | "reason"
    | "decisionNote"
    | "status"
    | "reviewedBy"
    | "reviewedAt"
    | "completedAt"
  > {}

class RecheckRequest
  extends Model<RecheckRequestAttributes, RecheckRequestCreationAttributes>
  implements RecheckRequestAttributes
{
  public id!: number;
  public requestId!: string;
  public studentId!: string;
  public instituteId!: string;
  public examId!: string;
  public evaluationId!: string;
  public subjectId!: string;
  public category!: RecheckCategory | null;
  public questions!: ClaimedQuestion[] | null;
  public reason!: string | null;
  public decisionNote!: string | null;
  public status!: RecheckStatus;
  public reviewedBy!: string | null;
  public reviewedAt!: Date | null;
  public completedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

RecheckRequest.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    requestId: { type: DataTypes.STRING, allowNull: false, unique: true },
    studentId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "viaexam_users",
        key: "userId",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    instituteId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "viaexam_institutes",
        key: "instituteId",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    examId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "viaexam_exams",
        key: "examId",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    evaluationId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "viaexam_ai_evaluations",
        key: "evaluationId",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    subjectId: {
      type: DataTypes.STRING,
      allowNull: false,
      references: {
        model: "viaexam_subjects",
        key: "subjectId",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },
    // Older requests have no category, questions or decision note (null).
    category: { type: DataTypes.STRING(40), allowNull: true, defaultValue: null },
    questions: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    reason: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    decisionNote: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    status: {
      type: DataTypes.ENUM("Pending", "Under Review", "Awaiting Approval", "Approved", "Rejected", "Completed"),
      allowNull: false,
      defaultValue: "Pending",
    },
    reviewedBy: {
      type: DataTypes.STRING,
      allowNull: true,
      references: {
        model: "viaexam_users",
        key: "userId",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    },
    reviewedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    completedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_recheck_requests",
    modelName: "RecheckRequest",
    timestamps: true,
    indexes: [
      { fields: ["studentId"], name: "viaexam_recheck_requests_student_id_index" },
      { fields: ["instituteId"], name: "viaexam_recheck_requests_institute_id_index" },
      { fields: ["examId"], name: "viaexam_recheck_requests_exam_id_index" },
      { fields: ["evaluationId"], name: "viaexam_recheck_requests_evaluation_id_index" },
      { fields: ["status"], name: "viaexam_recheck_requests_status_index" },
    ],
  },
);

export default RecheckRequest;