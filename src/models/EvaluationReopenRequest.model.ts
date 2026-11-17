import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// An evaluator's request to reopen marks they marked completed (a wrong mark they noticed, a sheet
// they want to evaluate again). Only the admin reopens them: they approve the request (the section
// is no longer completed and the same evaluator can change marks again) or decline it with a note.
// One open request per section (evaluation assignment) at a time; decided ones stay as history.
// Requests can't be made once results are published (marks then change only through a recheck) or
// while a cross-check holds the sheets (see services/evaluation/evaluationReopen.service.ts).

export const EVAL_REOPEN_STATUS = { PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" } as const;
export type EvaluationReopenStatus = (typeof EVAL_REOPEN_STATUS)[keyof typeof EVAL_REOPEN_STATUS];

interface EvaluationReopenRequestAttributes {
  id: number;
  requestId: string;
  instituteId: string;
  examId: string;
  /** The evaluation assignment (one section of the exam) it asks to reopen. */
  assignmentId: string;
  /** That assignment's section (null: the students without a section). */
  sectionId: string | null;
  /** User.userId of the evaluator who asked. */
  teacherId: string;
  reason: string;
  status: EvaluationReopenStatus;
  /** The admin who decided (or reassigned the section, which declines it). */
  decidedBy: string | null;
  decidedAt: Date | null;
  /** The admin's note to the evaluator: required when declining. */
  decisionNote: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface EvaluationReopenRequestCreationAttributes
  extends Optional<EvaluationReopenRequestAttributes, "id" | "status" | "decidedBy" | "decidedAt" | "decisionNote" | "sectionId"> {}

class EvaluationReopenRequest
  extends Model<EvaluationReopenRequestAttributes, EvaluationReopenRequestCreationAttributes>
  implements EvaluationReopenRequestAttributes
{
  public id!: number;
  public requestId!: string;
  public instituteId!: string;
  public examId!: string;
  public assignmentId!: string;
  public sectionId!: string | null;
  public teacherId!: string;
  public reason!: string;
  public status!: EvaluationReopenStatus;
  public decidedBy!: string | null;
  public decidedAt!: Date | null;
  public decisionNote!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EvaluationReopenRequest.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    requestId: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    assignmentId: { type: DataTypes.STRING(32), allowNull: false },
    sectionId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    teacherId: { type: DataTypes.STRING, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: EVAL_REOPEN_STATUS.PENDING,
      validate: { isIn: [Object.values(EVAL_REOPEN_STATUS)] },
    },
    decidedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    decidedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    decisionNote: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_evaluation_reopen_requests",
    modelName: "EvaluationReopenRequest",
    timestamps: true,
    indexes: [
      { name: "viaexam_eval_reopen_requests_institute_status", fields: ["instituteId", "status"] },
      { name: "viaexam_eval_reopen_requests_exam", fields: ["examId", "createdAt"] },
      { name: "viaexam_eval_reopen_requests_teacher", fields: ["teacherId", "examId"] },
      // At most one open request per section, even if two arrive at once.
      { name: "viaexam_eval_reopen_requests_one_pending", unique: true, fields: ["assignmentId"], where: { status: EVAL_REOPEN_STATUS.PENDING } },
    ],
  }
);

export default EvaluationReopenRequest;
