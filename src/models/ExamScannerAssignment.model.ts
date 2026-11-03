import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Which scanner uploads an approved exam's answer sheets, section by section.
// One active scanner per exam section (sectionId null: students without a section,
// or a class that has none); "all sections" is one row per section with the same
// scanner. Reassigning deactivates the previous row so the history of who scanned
// what is kept. The scanner marks a section COMPLETED once every student in it has
// a sheet or is marked absent. db/sectionWorkBackfill holds the unique index.

export const SCAN_STATUS = { ASSIGNED: "ASSIGNED", COMPLETED: "COMPLETED" } as const;
export type ScanStatus = (typeof SCAN_STATUS)[keyof typeof SCAN_STATUS];

interface ExamScannerAssignmentAttributes {
  id: number;
  assignmentId: string;
  instituteId: string;
  examId: string;
  sectionId: string | null; // the exam section this row covers
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
    "id" | "sectionId" | "note" | "status" | "isActive" | "completedAt" | "completedBy" | "unassignedAt"
  > {}

class ExamScannerAssignment
  extends Model<ExamScannerAssignmentAttributes, ExamScannerAssignmentCreationAttributes>
  implements ExamScannerAssignmentAttributes
{
  public id!: number;
  public assignmentId!: string;
  public instituteId!: string;
  public examId!: string;
  public sectionId!: string | null;
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
    sectionId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
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
      // At most one active scanner per exam section: a unique index on (examId, COALESCE(sectionId, ''))
      // that sync() can't declare, created in db/sectionWorkBackfill.
      { name: "viaexam_exam_scanner_assignments_exam", fields: ["examId"], where: { isActive: true } },
      { name: "viaexam_exam_scanner_assignments_scanner", fields: ["scannerId", "isActive"] },
      { name: "viaexam_exam_scanner_assignments_institute", fields: ["instituteId", "isActive"] },
    ],
  }
);

export default ExamScannerAssignment;
