import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Which teacher evaluates an approved exam's answer sheets.
// One active evaluator per exam; reassigning deactivates the previous row so the
// history of who evaluated what is kept.

interface EvaluationAssignmentAttributes {
  id: number;
  assignmentId: string;
  instituteId: string;
  examId: string;
  teacherId: string; // evaluator (User.userId)
  assignedBy: string; // admin (User.userId)
  note: string | null;
  isActive: boolean;
  unassignedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface EvaluationAssignmentCreationAttributes
  extends Optional<EvaluationAssignmentAttributes, "id" | "note" | "isActive" | "unassignedAt"> {}

class EvaluationAssignment
  extends Model<EvaluationAssignmentAttributes, EvaluationAssignmentCreationAttributes>
  implements EvaluationAssignmentAttributes
{
  public id!: number;
  public assignmentId!: string;
  public instituteId!: string;
  public examId!: string;
  public teacherId!: string;
  public assignedBy!: string;
  public note!: string | null;
  public isActive!: boolean;
  public unassignedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EvaluationAssignment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assignmentId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    teacherId: { type: DataTypes.STRING, allowNull: false },
    assignedBy: { type: DataTypes.STRING, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    unassignedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
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
