import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Which scanner uploads an approved exam's answer sheets.
// One active scanner per exam; reassigning deactivates the previous row so the
// history of who scanned what is kept. The scanner marks the work COMPLETED
// once every student of the exam has a sheet or is marked absent.

export const SCAN_STATUS = { ASSIGNED: "ASSIGNED", COMPLETED: "COMPLETED" } as const;
export type ScanStatus = (typeof SCAN_STATUS)[keyof typeof SCAN_STATUS];

interface ExamScannerAssignmentAttributes {
  id: number;
  assignmentId: string;
  instituteId: string;
  examId: string;
  scannerId: string; // User.userId of the SCANNER
  assignedBy: string; // admin User.userId
  note: string | null;
  status: ScanStatus;
  isActive: boolean;
  completedAt: Date | null;
  completedBy: string | null;
  unassignedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ExamScannerAssignmentCreationAttributes
  extends Optional<
    ExamScannerAssignmentAttributes,
    "id" | "note" | "status" | "isActive" | "completedAt" | "completedBy" | "unassignedAt"
  > {}

class ExamScannerAssignment
  extends Model<ExamScannerAssignmentAttributes, ExamScannerAssignmentCreationAttributes>
  implements ExamScannerAssignmentAttributes
{
  public id!: number;
  public assignmentId!: string;
  public instituteId!: string;
  public examId!: string;
  public scannerId!: string;
  public assignedBy!: string;
  public note!: string | null;
  public status!: ScanStatus;
  public isActive!: boolean;
  public completedAt!: Date | null;
  public completedBy!: string | null;
  public unassignedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExamScannerAssignment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    assignmentId: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    scannerId: { type: DataTypes.STRING, allowNull: false },
    assignedBy: { type: DataTypes.STRING, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: SCAN_STATUS.ASSIGNED,
      validate: { isIn: [Object.values(SCAN_STATUS)] },
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    completedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    completedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    unassignedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_exam_scanner_assignments",
    modelName: "ExamScannerAssignment",
    timestamps: true,
    indexes: [
      // At most one active scanner per exam, enforced by the database.
      { name: "viaexam_exam_scanner_assignments_one_active", unique: true, fields: ["examId"], where: { isActive: true } },
      { name: "viaexam_exam_scanner_assignments_scanner", fields: ["scannerId", "isActive"] },
      { name: "viaexam_exam_scanner_assignments_institute", fields: ["instituteId", "isActive"] },
    ],
  }
);

export default ExamScannerAssignment;
