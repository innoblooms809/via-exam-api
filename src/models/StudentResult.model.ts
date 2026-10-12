import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// A student's published result for one exam.
// Rows are written when the admin publishes an exam's results — a snapshot, so
// what the student sees can't drift if an evaluation is edited later. A recheck
// that changes the marks updates the row and bumps revisionCount. Unpublishing
// soft-deletes the rows (isDeleted) so the history is kept.

export const RESULT_STATUS = {
  PASS: "PASS",
  FAIL: "FAIL",
  ABSENT: "ABSENT",
  NOT_EVALUATED: "NOT_EVALUATED",
} as const;
export type ResultStatus = (typeof RESULT_STATUS)[keyof typeof RESULT_STATUS];

interface StudentResultAttributes {
  id: number;
  resultId: string;
  instituteId: string;
  examId: string;
  studentId: string;
  rollNo: string;
  classId: string | null;
  sectionId: string | null;
  sessionId: string;
  subjectId: string;
  examType: string;
  sheetId: string | null;
  evaluationId: string | null;
  marksObtained: number | null;
  totalMarks: number;
  passingMarks: number;
  percentage: number | null;
  grade: string | null;
  resultStatus: ResultStatus;
  publishedAt: Date;
  publishedBy: string;
  revisedAt: Date | null;
  revisionCount: number;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface StudentResultCreationAttributes
  extends Optional<
    StudentResultAttributes,
    | "id"
    | "classId"
    | "sectionId"
    | "sheetId"
    | "evaluationId"
    | "marksObtained"
    | "percentage"
    | "grade"
    | "revisedAt"
    | "revisionCount"
    | "isDeleted"
  > {}

class StudentResult
  extends Model<StudentResultAttributes, StudentResultCreationAttributes>
  implements StudentResultAttributes
{
  public id!: number;
  public resultId!: string;
  public instituteId!: string;
  public examId!: string;
  public studentId!: string;
  public rollNo!: string;
  public classId!: string | null;
  public sectionId!: string | null;
  public sessionId!: string;
  public subjectId!: string;
  public examType!: string;
  public sheetId!: string | null;
  public evaluationId!: string | null;
  public marksObtained!: number | null;
  public totalMarks!: number;
  public passingMarks!: number;
  public percentage!: number | null;
  public grade!: string | null;
  public resultStatus!: ResultStatus;
  public publishedAt!: Date;
  public publishedBy!: string;
  public revisedAt!: Date | null;
  public revisionCount!: number;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StudentResult.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    resultId: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    studentId: { type: DataTypes.STRING, allowNull: false },
    rollNo: { type: DataTypes.STRING(32), allowNull: false },
    classId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    sectionId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    subjectId: { type: DataTypes.STRING, allowNull: false },
    examType: { type: DataTypes.STRING, allowNull: false },
    sheetId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    evaluationId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    marksObtained: { type: DataTypes.DECIMAL(7, 2), allowNull: true, defaultValue: null },
    totalMarks: { type: DataTypes.INTEGER, allowNull: false },
    passingMarks: { type: DataTypes.INTEGER, allowNull: false },
    percentage: { type: DataTypes.DECIMAL(5, 2), allowNull: true, defaultValue: null },
    grade: { type: DataTypes.STRING(4), allowNull: true, defaultValue: null },
    resultStatus: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: { isIn: [Object.values(RESULT_STATUS)] },
    },
    publishedAt: { type: DataTypes.DATE, allowNull: false },
    publishedBy: { type: DataTypes.STRING, allowNull: false },
    revisedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    revisionCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    tableName: "viaexam_student_results",
    modelName: "StudentResult",
    timestamps: true,
    indexes: [
      // One live result per student per exam.
      {
        name: "viaexam_student_results_exam_student",
        unique: true,
        fields: ["examId", "studentId"],
        where: { isDeleted: false },
      },
      { name: "viaexam_student_results_student", fields: ["studentId", "isDeleted"] },
      { name: "viaexam_student_results_institute_exam", fields: ["instituteId", "examId"] },
    ],
  }
);

export default StudentResult;
