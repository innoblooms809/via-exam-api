import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

export interface UserPresenceSessionAttributes {
  id: number;
  userId: string;
  role: string;
  instituteId: string | null;
  presenceStatus: "ONLINE" | "IDLE" | "OFFLINE" | "BLOCKED";
  currentActivity?: string | null;
  lastActivityAt: Date;
  lastLoginAt?: Date | null;
  lastLogoutAt?: Date | null;
  deviceInfo?: string | null;
  ipAddress?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserPresenceSessionCreationAttributes
  extends Optional<
    UserPresenceSessionAttributes,
    | "id"
    | "instituteId"
    | "presenceStatus"
    | "currentActivity"
    | "lastLoginAt"
    | "lastLogoutAt"
    | "deviceInfo"
    | "ipAddress"
  > {}

class UserPresenceSession
  extends Model<
    UserPresenceSessionAttributes,
    UserPresenceSessionCreationAttributes
  >
  implements UserPresenceSessionAttributes
{
  public id!: number;
  public userId!: string;
  public role!: string;
  public instituteId!: string | null;
  public presenceStatus!: "ONLINE" | "IDLE" | "OFFLINE" | "BLOCKED";
  public currentActivity!: string | null;
  public lastActivityAt!: Date;
  public lastLoginAt!: Date | null;
  public lastLogoutAt!: Date | null;
  public deviceInfo!: string | null;
  public ipAddress!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserPresenceSession.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    role: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    instituteId: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    presenceStatus: {
      type: DataTypes.ENUM("ONLINE", "IDLE", "OFFLINE", "BLOCKED"),
      allowNull: false,
      defaultValue: "OFFLINE",
    },
    currentActivity: {
      type: DataTypes.STRING(255),
      allowNull: true,
      defaultValue: "Active in Portal",
    },
    lastActivityAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    lastLoginAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    lastLogoutAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    deviceInfo: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    ipAddress: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: "viaexam_user_presence_sessions",
    modelName: "UserPresenceSession",
    timestamps: true,
    indexes: [
      { fields: ["userId"] },
      { fields: ["instituteId"] },
      { fields: ["presenceStatus"] },
      { fields: ["lastActivityAt"] },
    ],
  }
);

export default UserPresenceSession;
