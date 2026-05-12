import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface ExamAttributes {
  id: number;
  examId: string;
  instituteId: string; // FK → Institute
  session: string; // 2024-25
  year: string; // 1st Year
  examType: string; // Mid-Term, Final etc
  examDate: Date;
  classVal: string; // Class 10
  subject: string; // Mathematics
  teacherId: string; // FK → User (teacher)
  examinerId: string | null; // FK → User (examiner) — assigned later
  totalMarks: number;
  passingMarks: number;
  duration: number | null;
  instructions: string | null;
  status: string; // Draft, Live, Completed
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ExamCreationAttributes
  extends Optional<
    ExamAttributes,
    | "id"
    | "examId"
    | "examinerId"
    | "duration"
    | "instructions"
    | "status"
    | "isDeleted"
  > {}

class Exam extends Model<ExamAttributes, ExamCreationAttributes> {
  public id!: number;
  public examId!: string;
  public instituteId!: string;
  public session!: string;
  public year!: string;
  public examType!: string;
  public examDate!: Date;
  public classVal!: string;
  public subject!: string;
  public teacherId!: string;
  public examinerId!: string | null;
  public totalMarks!: number;
  public passingMarks!: number;
  public duration!: number | null;
  public instructions!: string | null;
  public status!: string;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Exam.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    examId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    session: { type: DataTypes.STRING, allowNull: false },
    year: { type: DataTypes.STRING, allowNull: false },
    examType: { type: DataTypes.STRING, allowNull: false },
    examDate: { type: DataTypes.DATE, allowNull: false },
    classVal: { type: DataTypes.STRING, allowNull: false },
    subject: { type: DataTypes.STRING, allowNull: false },
    teacherId: { type: DataTypes.STRING, allowNull: false },
    examinerId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    totalMarks: { type: DataTypes.INTEGER, allowNull: false },
    passingMarks: { type: DataTypes.INTEGER, allowNull: false },
    duration: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    instructions: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "Draft" },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: "viaexam_exams",
    modelName: "Exam",
    timestamps: true,
  },
);

export default Exam;
