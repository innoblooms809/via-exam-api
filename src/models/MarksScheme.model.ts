import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Maximum and pass marks of one subject for one exam of one session — e.g. Mathematics,
// Class 9, Mid Term 2026-2027: 80 marks, 27 to pass. Set once in Master Data → Marks &
// grading; every exam of that subject takes its marks from here (the exam form doesn't
// ask), its question papers must add up to it, and report cards use it.

interface MarksSchemeAttributes {
  id: number;
  instituteId: string;
  sessionId: string;
  /** "Mid Term" / "Final" */
  examType: string;
  classId: string;
  subjectId: string;
  maxMarks: number;
  passMarks: number;
  /** User.userId of who set it last. */
  updatedBy: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface MarksSchemeCreationAttributes extends Optional<MarksSchemeAttributes, "id" | "updatedBy"> {}

class MarksScheme extends Model<MarksSchemeAttributes, MarksSchemeCreationAttributes> implements MarksSchemeAttributes {
  public id!: number;
  public instituteId!: string;
  public sessionId!: string;
  public examType!: string;
  public classId!: string;
  public subjectId!: string;
  public maxMarks!: number;
  public passMarks!: number;
  public updatedBy!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

MarksScheme.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    examType: { type: DataTypes.STRING, allowNull: false },
    classId: { type: DataTypes.STRING, allowNull: false },
    subjectId: { type: DataTypes.STRING, allowNull: false },
    maxMarks: { type: DataTypes.INTEGER, allowNull: false },
    passMarks: { type: DataTypes.INTEGER, allowNull: false },
    updatedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_marks_schemes",
    modelName: "MarksScheme",
    timestamps: true,
    indexes: [
      { name: "viaexam_marks_schemes_session_exam_subject", unique: true, fields: ["sessionId", "examType", "subjectId"] },
      { name: "viaexam_marks_schemes_institute_session", fields: ["instituteId", "sessionId", "examType"] },
    ],
  }
);

export default MarksScheme;
