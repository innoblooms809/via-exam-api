import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// A section that runs in one session, with that year's class teacher.
//
// Classes and sections are master data and carry over from year to year; which of
// them run in a session, and who looks after each, is set per session here. Last
// year's rows stay as they were, so the school's history (who was class teacher of
// 9-A in 2025-2026) is never overwritten. See services/academic/sessionSetup.service.

interface SessionSectionAttributes {
  id: number;
  instituteId: string;
  sessionId: string;
  classId: string;
  sectionId: string;
  /** User.userId of the class teacher in this session, or null. */
  classTeacherId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SessionSectionCreationAttributes extends Optional<SessionSectionAttributes, "id" | "classTeacherId"> {}

class SessionSection extends Model<SessionSectionAttributes, SessionSectionCreationAttributes> implements SessionSectionAttributes {
  public id!: number;
  public instituteId!: string;
  public sessionId!: string;
  public classId!: string;
  public sectionId!: string;
  public classTeacherId!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SessionSection.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    classId: { type: DataTypes.STRING, allowNull: false },
    sectionId: { type: DataTypes.STRING, allowNull: false },
    classTeacherId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_session_sections",
    modelName: "SessionSection",
    timestamps: true,
    indexes: [
      { name: "viaexam_session_sections_session_section", unique: true, fields: ["sessionId", "sectionId"] },
      { name: "viaexam_session_sections_institute_session", fields: ["instituteId", "sessionId"] },
      { name: "viaexam_session_sections_class_teacher", fields: ["classTeacherId"] },
    ],
  }
);

export default SessionSection;
