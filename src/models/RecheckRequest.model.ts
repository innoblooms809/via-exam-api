import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface RecheckRequestAttributes {
  id: number;
  requestId: string;
  studentId: string;
  instituteId: string;
  examId: string;
  evaluationId: string;
  subjectId: string;
  reason: string | null;
  status: "Pending" | "Under Review" | "Approved" | "Rejected" | "Completed";
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
    | "reason"
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
  public reason!: string | null;
  public status!: "Pending" | "Under Review" | "Approved" | "Rejected" | "Completed";
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
    reason: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    status: {
      type: DataTypes.ENUM("Pending", "Under Review", "Approved", "Rejected", "Completed"),
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