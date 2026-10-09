import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface PasswordResetAttributes {
  id: number;
  email: string;
  otp: string;
  expiresAt: Date;
  isUsed: boolean;
}

interface PasswordResetCreationAttributes
  extends Optional<PasswordResetAttributes, "id" | "isUsed"> {}

class PasswordReset extends Model<
  PasswordResetAttributes,
  PasswordResetCreationAttributes
> {
  public id!: number;
  public email!: string;
  public otp!: string;
  public expiresAt!: Date;
  public isUsed!: boolean;
}

PasswordReset.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    email: { type: DataTypes.STRING, allowNull: false },
    otp: { type: DataTypes.STRING, allowNull: false },
    expiresAt: { type: DataTypes.DATE, allowNull: false },
    isUsed: { type: DataTypes.BOOLEAN, defaultValue: false },
  },
  {
    sequelize,
    tableName: "viaexam_password_resets",
    modelName: "PasswordReset",
    timestamps: true,
  }
);

export default PasswordReset;