import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// One row per browser/device that accepted push notifications (Firebase Cloud Messaging).
interface PushTokenAttributes {
  id: number;
  token: string;
  userId: string;
  instituteId: string | null;
  role: string | null;
  appUrl: string | null;
  userAgent: string | null;
  lastSeenAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PushTokenCreationAttributes
  extends Optional<PushTokenAttributes, "id" | "instituteId" | "role" | "appUrl" | "userAgent" | "lastSeenAt"> {}

class PushToken extends Model<PushTokenAttributes, PushTokenCreationAttributes> {
  public id!: number;
  public token!: string;
  public userId!: string;
  public instituteId!: string | null;
  public role!: string | null;
  public appUrl!: string | null;
  public userAgent!: string | null;
  public lastSeenAt!: Date;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

PushToken.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    token: { type: DataTypes.TEXT, allowNull: false, unique: true },
    userId: { type: DataTypes.STRING, allowNull: false },
    instituteId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    role: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    // Page the push opens when clicked, e.g. https://host/school-slug/teacher/dashboard
    appUrl: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    userAgent: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    lastSeenAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize,
    tableName: "viaexam_push_tokens",
    modelName: "PushToken",
    timestamps: true,
    indexes: [{ fields: ["userId"] }],
  }
);

export default PushToken;
