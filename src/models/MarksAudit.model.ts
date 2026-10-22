import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Every change to marks, with who made it and when — so a school can always answer
// "who changed this mark, from what, and why" (and, for a recheck, which admin approved it):
//   max-marks / pass-marks   a subject's marks on Marks & grading (or an exam's)
//   student-marks            a student's marks after evaluation (evaluator edit,
//                            recheck, cross-check)
//   grading-scale            the grade bands
// Rows are only ever added.

export const MARKS_CHANGE = {
  MAX: "max-marks",
  PASS: "pass-marks",
  STUDENT: "student-marks",
  SCALE: "grading-scale",
} as const;
export type MarksChange = (typeof MARKS_CHANGE)[keyof typeof MARKS_CHANGE];

/** Where the change was made. */
export const MARKS_SOURCE = {
  SETUP: "marks-setup",
  EVALUATION: "evaluation",
  RECHECK: "recheck",
  CROSS_CHECK: "cross-check",
} as const;
export type MarksSource = (typeof MARKS_SOURCE)[keyof typeof MARKS_SOURCE];

interface MarksAuditAttributes {
  id: number;
  instituteId: string;
  what: MarksChange;
  source: MarksSource;
  sessionId: string | null;
  examType: string | null;
  examId: string | null;
  subjectId: string | null;
  studentId: string | null;
  sheetId: string | null;
  oldValue: string | null;
  newValue: string | null;
  reason: string | null;
  changedBy: string;
  /** The admin who approved the change (a recheck decision); null when none was needed. */
  approvedBy: string | null;
  createdAt?: Date;
}

interface MarksAuditCreationAttributes
  extends Optional<
    MarksAuditAttributes,
    "id" | "sessionId" | "examType" | "examId" | "subjectId" | "studentId" | "sheetId" | "oldValue" | "newValue" | "reason" | "approvedBy"
  > {}

class MarksAudit extends Model<MarksAuditAttributes, MarksAuditCreationAttributes> implements MarksAuditAttributes {
  public id!: number;
  public instituteId!: string;
  public what!: MarksChange;
  public source!: MarksSource;
  public sessionId!: string | null;
  public examType!: string | null;
  public examId!: string | null;
  public subjectId!: string | null;
  public studentId!: string | null;
  public sheetId!: string | null;
  public oldValue!: string | null;
  public newValue!: string | null;
  public reason!: string | null;
  public changedBy!: string;
  public approvedBy!: string | null;
  public readonly createdAt!: Date;
}

MarksAudit.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    what: { type: DataTypes.STRING(32), allowNull: false },
    source: { type: DataTypes.STRING(32), allowNull: false },
    sessionId: { type: DataTypes.STRING, allowNull: true },
    examType: { type: DataTypes.STRING, allowNull: true },
    examId: { type: DataTypes.STRING, allowNull: true },
    subjectId: { type: DataTypes.STRING, allowNull: true },
    studentId: { type: DataTypes.STRING, allowNull: true },
    sheetId: { type: DataTypes.STRING, allowNull: true },
    oldValue: { type: DataTypes.STRING(255), allowNull: true },
    newValue: { type: DataTypes.STRING(255), allowNull: true },
    reason: { type: DataTypes.TEXT, allowNull: true },
    changedBy: { type: DataTypes.STRING, allowNull: false },
    approvedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_marks_audit",
    modelName: "MarksAudit",
    timestamps: true,
    updatedAt: false,
    indexes: [
      { name: "viaexam_marks_audit_institute_created", fields: ["instituteId", "createdAt"] },
      { name: "viaexam_marks_audit_exam", fields: ["examId"] },
      { name: "viaexam_marks_audit_student", fields: ["studentId"] },
    ],
  }
);

export default MarksAudit;
