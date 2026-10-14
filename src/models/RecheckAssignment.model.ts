import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Who re-evaluates a student's recheck request, and what came of it.
// One row per recheck request (requestId is unique); reassigning to another
// teacher updates the row. Kept apart from viaexam_recheck_requests so that
// table's columns don't change.

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
  createdAt?: Date;
  updatedAt?: Date;
}

interface RecheckAssignmentCreationAttributes
  extends Optional<RecheckAssignmentAttributes, "id" | "previousScore" | "revisedScore" | "teacherNote" | "completedAt"> {}

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
