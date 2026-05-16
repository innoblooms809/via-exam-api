import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface ExamAttributes {
  id: number;
  examId: string;
  instituteId: string; // FK → Institute
  classId: string | null; // FK → Class, nullable for school-wide exams
  sessionId: string; // 2024-25
  examType: string; // Mid-Term, Final etc
  subjectId: string; // Mathematics
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
    | "classId"
  > {}

class Exam extends Model<ExamAttributes, ExamCreationAttributes> {
  public id!: number;
  public examId!: string;
  public instituteId!: string;
  public classId!: string | null;
  public sessionId!: string;
  public examType!: string;
  public subjectId!: string;
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
    classId: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
      references: {
        model: "viaexam_classes",
        key: "classId",
      },
    },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    examType: { type: DataTypes.STRING, allowNull: false },
    subjectId: { type: DataTypes.STRING, allowNull: false },
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


// Exam.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });
// // Exam belongs to Subject
// Exam.belongsTo(Subject, {
//   foreignKey: "subjectId",
//   targetKey: "subjectId",
//   as: "subject",
// });


// Exam.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });

// Exam.belongsTo(User, {
//   foreignKey: "assignedTeacherId",
//   targetKey: "userId",
//   as: "teacher",
// });

// // // Exam has many Question Papers
// // Exam.hasMany(QuestionPaper, {
// //   foreignKey: "examId",
// //   sourceKey: "examId",
// //   as: "questionPapers",
// // });

export default Exam;
