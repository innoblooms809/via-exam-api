import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

export interface ActivityLogAttributes {
  id: number;
  eventId: string;
  userId: string;
  role: string;
  instituteId: string | null;
  eventType: string; // e.g. LOGIN_SUCCESS, EXAM_STARTED, SHEET_UPLOAD_COMPLETED, EVALUATION_COMPLETED
  entityType?: string | null; // e.g. EXAM, EVALUATION, SHEET, USER
  entityId?: string | null;
  status: string; // SUCCESS, FAILED, IN_PROGRESS, PENDING
  metadata?: any;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ActivityLogCreationAttributes
  extends Optional<
    ActivityLogAttributes,
    | "id"
    | "eventId"
    | "instituteId"
    | "entityType"
    | "entityId"
    | "status"
    | "metadata"
    | "ipAddress"
    | "userAgent"
  > {}

class ActivityLog
  extends Model<ActivityLogAttributes, ActivityLogCreationAttributes>
  implements ActivityLogAttributes
{
  public id!: number;
  public eventId!: string;
  public userId!: string;
  public role!: string;
  public instituteId!: string | null;
  public eventType!: string;
  public entityType!: string | null;
  public entityId!: string | null;
  public status!: string;
  public metadata!: any;
  public ipAddress!: string | null;
  public userAgent!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ActivityLog.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    eventId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    userId: {
      type: DataTypes.STRING(64),
      allowNull: false,
    },
    role: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    instituteId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    eventType: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    entityType: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    entityId: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: "SUCCESS",
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    ipAddress: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    userAgent: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "viaexam_activity_logs",
    modelName: "ActivityLog",
    timestamps: true,
    indexes: [
      { fields: ["userId"] },
      { fields: ["instituteId"] },
      { fields: ["eventType"] },
      { fields: ["status"] },
      { fields: ["createdAt"] },
    ],
  }
);

export default ActivityLog;
