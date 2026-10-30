import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Who re-evaluates a student's recheck request, and what came of it.
// One row per recheck request (requestId is unique); reassigning to another
// teacher updates the row.
// The teacher's decision (revisedScore, teacherNote, completedAt = when they sent it)
// reaches the result only once an admin approves it (approvedBy, approvedAt). An admin
// can send it back instead (returnNote, returnedAt): completedAt is cleared and the
// teacher decides again.
//
// While it is open the teacher can re-evaluate the sheet on the evaluation screen (AI run
// and question-wise marks). That work is a draft here, never the live evaluation, so the
// student keeps seeing the published marks until the admin approves. `changes` is what
// the decision changes, question by question (kept for the marks history).

/** The recheck teacher's re-evaluation of the sheet, before the admin approves it. */
export interface RecheckDraft {
  evaluations: any[];
  totalScore: number | null;
  feedback: string | null;
  /** Ready: marks to use · Pending: the AI is re-evaluating · Failed: the last AI run failed. */
  status: "Ready" | "Pending" | "Failed";
  error?: string | null;
  aiRunAt?: string | null;
  editedAt?: string | null;
}

/** One question whose marks a decision changes. */
export interface QuestionChange {
  questionId: string;
  /** "Q3(b)" */
  label: string;
  from: number | null;
  to: number | null;
  max: number | null;
}

interface RecheckAssignmentAttributes {
  id: number;
  requestId: string;
  instituteId: string;
  examId: string;
  teacherId: string; // re-evaluator (User.userId)
  assignedBy: string; // admin (User.userId)
  assignedAt: Date;
  previousScore: number | null;
  revisedScore: number | null;
  teacherNote: string | null;
  completedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  returnNote: string | null;
  returnedAt: Date | null;
  draft: RecheckDraft | null;
  changes: QuestionChange[] | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface RecheckAssignmentCreationAttributes
  extends Optional<RecheckAssignmentAttributes, "id" | "previousScore" | "revisedScore" | "teacherNote" | "completedAt" | "approvedBy" | "approvedAt" | "returnNote" | "returnedAt" | "draft" | "changes"> {}

class RecheckAssignment
  extends Model<RecheckAssignmentAttributes, RecheckAssignmentCreationAttributes>
  implements RecheckAssignmentAttributes
{
  public id!: number;
  public requestId!: string;
  public instituteId!: string;
  public examId!: string;
  public teacherId!: string;
  public assignedBy!: string;
  public assignedAt!: Date;
  public previousScore!: number | null;
  public revisedScore!: number | null;
  public teacherNote!: string | null;
  public completedAt!: Date | null;
  public approvedBy!: string | null;
  public approvedAt!: Date | null;
  public returnNote!: string | null;
  public returnedAt!: Date | null;
  public draft!: RecheckDraft | null;
  public changes!: QuestionChange[] | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

RecheckAssignment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    requestId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    teacherId: { type: DataTypes.STRING, allowNull: false },
    assignedBy: { type: DataTypes.STRING, allowNull: false },
    assignedAt: { type: DataTypes.DATE, allowNull: false },
    previousScore: { type: DataTypes.DECIMAL(7, 2), allowNull: true, defaultValue: null },
    revisedScore: { type: DataTypes.DECIMAL(7, 2), allowNull: true, defaultValue: null },
    teacherNote: { type: DataTypes.STRING(1000), allowNull: true, defaultValue: null },
    completedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    approvedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    approvedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    returnNote: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    returnedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    draft: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    changes: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_recheck_assignments",
    modelName: "RecheckAssignment",
    timestamps: true,
    indexes: [{ name: "viaexam_recheck_assignments_teacher", fields: ["teacherId", "completedAt"] }],
  }
);

export default RecheckAssignment;
