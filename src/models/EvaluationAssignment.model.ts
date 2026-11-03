import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Which teacher evaluates an approved exam's answer sheets, section by section.
// One active evaluator per exam section (sectionId null: students without a section,
// or a class that has none); "all sections" is one row per section with the same
// teacher, each reviewed on its own. Reassigning deactivates the previous row so the
// history of who evaluated what is kept. db/sectionWorkBackfill holds the unique index.

interface EvaluationAssignmentAttributes {
  id: number;
  assignmentId: string;
  instituteId: string;
  examId: string;
  sectionId: string | null; // the exam section this row covers
  teacherId: string; // evaluator (User.userId)
  assignedBy: string; // admin (User.userId)
  note: string | null;
  isActive: boolean;
  unassignedAt: Date | null;
  /** Set when the assigned teacher marks the evaluation as reviewed. */
  reviewedAt: Date | null;
  /** The teacher (User.userId) who marked it reviewed. */
  reviewedBy: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface EvaluationAssignmentCreationAttributes
  extends Optional<EvaluationAssignmentAttributes, "id" | "sectionId" | "note" | "isActive" | "unassignedAt" | "reviewedAt" | "reviewedBy"> {}

class EvaluationAssignment
  extends Model<EvaluationAssignmentAttributes, EvaluationAssignmentCreationAttributes>
  implements EvaluationAssignmentAttributes
{
  public id!: number;
  public assignmentId!: string;
  public instituteId!: string;
  public examId!: string;
  public sectionId!: string | null;
  public teacherId!: string;
  public assignedBy!: string;
  public note!: string | null;
  public isActive!: boolean;
  public unassignedAt!: Date | null;
  public reviewedAt!: Date | null;
  public reviewedBy!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EvaluationAssignment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assignmentId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    sectionId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    teacherId: { type: DataTypes.STRING, allowNull: false },
    assignedBy: { type: DataTypes.STRING, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    unassignedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    reviewedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    reviewedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_evaluation_assignments",
    modelName: "EvaluationAssignment",
    timestamps: true,
    indexes: [
      { fields: ["examId", "isActive"] },
      { fields: ["teacherId", "isActive"] },
    ],
  }
);

export default EvaluationAssignment;
