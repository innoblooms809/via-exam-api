import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface PasswordResetAttributes {
  id: number;
  email: string;
  /** HMAC digest of the code (utils/dataProtection), never the code itself. */
  otp: string;
  expiresAt: Date;
  isUsed: boolean;
  /** Wrong codes tried against this one; it is burned at MAX_OTP_ATTEMPTS. */
  attempts: number;
  createdAt?: Date;
}

interface PasswordResetCreationAttributes
  extends Optional<PasswordResetAttributes, "id" | "isUsed" | "attempts"> {}

class PasswordReset extends Model<
  PasswordResetAttributes,
  PasswordResetCreationAttributes
> {
  public id!: number;
  public email!: string;
  public otp!: string;
  public expiresAt!: Date;
  public isUsed!: boolean;
  public attempts!: number;
  public readonly createdAt!: Date;
}

PasswordReset.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING, allowNull: false },
    otp: { type: DataTypes.STRING, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    isUsed: { type: DataTypes.BOOLEAN, defaultValue: false },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  },
  {
    sequelize,
    tableName: "viaexam_password_resets",
    modelName: "PasswordReset",
    timestamps: true,
  }
);

export default PasswordReset;
