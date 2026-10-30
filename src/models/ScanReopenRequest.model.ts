import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// A scanner's request to re-open uploading for an exam they marked complete (a late sheet,
// a student wrongly marked absent). Only the admin can re-open it: they approve the request
// (uploading re-opens for the same scanner) or reject it with a note. One open request per
// exam at a time; decided ones stay as history.

export const REOPEN_STATUS = { PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" } as const;
export type ReopenStatus = (typeof REOPEN_STATUS)[keyof typeof REOPEN_STATUS];

interface ScanReopenRequestAttributes {
  id: number;
  requestId: string;
  instituteId: string;
  examId: string;
  /** The scanner assignment it asks to re-open. */
  assignmentId: string;
  /** User.userId of the SCANNER who asked. */
  scannerId: string;
  reason: string;
  status: ReopenStatus;
  /** The admin who decided (or re-opened / reassigned the exam, which decides it too). */
  decidedBy: string | null;
  decidedAt: Date | null;
  /** The admin's note to the scanner: required when rejecting. */
  decisionNote: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ScanReopenRequestCreationAttributes
  extends Optional<ScanReopenRequestAttributes, "id" | "status" | "decidedBy" | "decidedAt" | "decisionNote"> {}

class ScanReopenRequest
  extends Model<ScanReopenRequestAttributes, ScanReopenRequestCreationAttributes>
  implements ScanReopenRequestAttributes
{
  public id!: number;
  public requestId!: string;
  public instituteId!: string;
  public examId!: string;
  public assignmentId!: string;
  public scannerId!: string;
  public reason!: string;
  public status!: ReopenStatus;
  public decidedBy!: string | null;
  public decidedAt!: Date | null;
  public decisionNote!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ScanReopenRequest.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    requestId: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    assignmentId: { type: DataTypes.STRING(32), allowNull: false },
    scannerId: { type: DataTypes.STRING, allowNull: false },
    reason: { type: DataTypes.TEXT, allowNull: false },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      defaultValue: REOPEN_STATUS.PENDING,
      validate: { isIn: [Object.values(REOPEN_STATUS)] },
    },
    decidedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    decidedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    decisionNote: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_scan_reopen_requests",
    modelName: "ScanReopenRequest",
    timestamps: true,
    indexes: [
      { name: "viaexam_scan_reopen_requests_institute_status", fields: ["instituteId", "status"] },
      { name: "viaexam_scan_reopen_requests_exam", fields: ["examId", "createdAt"] },
      // At most one open request per exam, even if two arrive at once.
      { name: "viaexam_scan_reopen_requests_one_pending", unique: true, fields: ["examId"], where: { status: REOPEN_STATUS.PENDING } },
    ],
  }
);

export default ScanReopenRequest;
