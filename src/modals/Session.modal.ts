import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
import Institute from "./Institute.modal";
import Class from "./Class.modal";

interface SessionAttributes {
  id: number;
  sessionId: string;
  instituteId: string; // FK → Institute
  sessionName: string; // 2024-25
  startDate: Date;
  endDate: Date;
  isActive: boolean; // only one session active at a time
  isDeleted: boolean; // for soft delete
  createdAt?: Date;
  updatedAt?: Date;
}

interface SessionCreationAttributes
  extends Optional<SessionAttributes, "id" | "sessionId" | "isActive" | "isDeleted"> {}

class Session extends Model<SessionAttributes, SessionCreationAttributes> {
  public id!: number;
  public sessionId!: string;
  public instituteId!: string;
  public sessionName!: string;
  public startDate!: Date;
  public endDate!: Date;
  public isActive!: boolean;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Session.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sessionId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    sessionName: { type: DataTypes.STRING, allowNull: false },
    startDate: { type: DataTypes.DATE, allowNull: false },
    endDate: { type: DataTypes.DATE, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
  },
  {
    sequelize,
    tableName: "viaexam_sessions",
    modelName: "Session",
    timestamps: true,
    indexes: [
      {
        // One session name per institute
        unique: true,
        fields: ["instituteId", "sessionName"],
      },
    ],
    
  },
);

// ─── ASSOCIATIONS ─────────────────────────────────────────

Session.belongsTo(Institute, {
  foreignKey: "instituteId",
  targetKey: "instituteId",
  as: "institute",
});

// Session has many Classes
Session.hasMany(Class, {
  foreignKey: "sessionId",
  sourceKey: "sessionId",
  as: "classes",
});

export default Session;
