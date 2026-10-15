import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// A subject taught in one session, with that year's subject teacher (who sets its
// question papers by default).
//
// Subjects are master data (name, code, default marks, the class they belong to);
// whether a class studies one in a session, and who teaches it, is set per session
// here. A subject taught by different teachers in different sections is kept as
// one subject per section in master data, as schools already do.

interface SessionSubjectAttributes {
  id: number;
  instituteId: string;
  sessionId: string;
  classId: string;
  subjectId: string;
  /** User.userId of the subject teacher in this session, or null. */
  teacherId: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SessionSubjectCreationAttributes extends Optional<SessionSubjectAttributes, "id" | "teacherId"> {}

class SessionSubject extends Model<SessionSubjectAttributes, SessionSubjectCreationAttributes> implements SessionSubjectAttributes {
  public id!: number;
  public instituteId!: string;
  public sessionId!: string;
  public classId!: string;
  public subjectId!: string;
  public teacherId!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SessionSubject.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    classId: { type: DataTypes.STRING, allowNull: false },
    subjectId: { type: DataTypes.STRING, allowNull: false },
    teacherId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_session_subjects",
    modelName: "SessionSubject",
    timestamps: true,
    indexes: [
      { name: "viaexam_session_subjects_session_subject", unique: true, fields: ["sessionId", "subjectId"] },
      { name: "viaexam_session_subjects_institute_session", fields: ["instituteId", "sessionId"] },
      { name: "viaexam_session_subjects_teacher", fields: ["teacherId"] },
    ],
  }
);

export default SessionSubject;
