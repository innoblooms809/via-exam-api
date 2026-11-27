import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

/**
 * One signed-in browser or device (services/auth/session.service). The browser holds the
 * session's tokens in httpOnly cookies; this row holds only an HMAC digest of the current refresh
 * token (utils/dataProtection), so a copy of the database can't sign anyone in.
 */
export interface UserSessionAttributes {
  /** Random; the "sid" claim of the session's access and refresh tokens. */
  id: string;
  userId: string;
  /** Digest of the current refresh token. */
  tokenHash: string;
  /** Digest of the token it replaced, accepted for a few seconds after the change (two tabs refreshing at once). */
  previousHash: string | null;
  rotatedAt: Date | null;
  /** Inactivity limit: moved forward at each refresh. */
  expiresAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  /** logout, logout-all, replaced, reuse, expired, inactive, password-change, password-reset */
  revokedReason: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type UserSessionCreationAttributes = Optional<
  UserSessionAttributes,
  "previousHash" | "rotatedAt" | "revokedAt" | "revokedReason" | "userAgent" | "ipAddress"
>;

class UserSession extends Model<UserSessionAttributes, UserSessionCreationAttributes> implements UserSessionAttributes {
  public id!: string;
  public userId!: string;
  public tokenHash!: string;
  public previousHash!: string | null;
  public rotatedAt!: Date | null;
  public expiresAt!: Date;
  public lastUsedAt!: Date;
  public revokedAt!: Date | null;
  public revokedReason!: string | null;
  public userAgent!: string | null;
  public ipAddress!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

UserSession.init(
  {
    id: { type: DataTypes.STRING(64), primaryKey: true },
    userId: { type: DataTypes.STRING(64), allowNull: false },
    tokenHash: { type: DataTypes.STRING(160), allowNull: false },
    previousHash: { type: DataTypes.STRING(160), allowNull: true, defaultValue: null },
    rotatedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    lastUsedAt: { type: DataTypes.DATE, allowNull: false },
    revokedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    revokedReason: { type: DataTypes.STRING(32), allowNull: true, defaultValue: null },
    userAgent: { type: DataTypes.STRING(500), allowNull: true, defaultValue: null },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_user_sessions",
    modelName: "UserSession",
    timestamps: true,
    indexes: [
      { name: "viaexam_user_sessions_user_idx", fields: ["userId"] },
      { name: "viaexam_user_sessions_expires_idx", fields: ["expiresAt"] },
    ],
  }
);

export default UserSession;
