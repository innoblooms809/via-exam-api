import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface AIEvaluationAttributes {
  id: number;
  evaluationId: string;
  sheetId: string;
  studentId: string;
  examId: string;
  classId: string;
  section: string;
  subjectId: string;
  examType: string;
  totalScore: number;
  feedback: string;
  evaluations: any; // JSON containing array of QuestionEvaluation objects
  studentAnsOcr: string;
  standardAnsOcr: string;
  questionOcr: string;
  status: string; // 'Pending', 'Success', 'Failed'
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AIEvaluationCreationAttributes
  extends Optional<
    AIEvaluationAttributes,
    | "id"
    | "evaluationId"
    | "totalScore"
    | "feedback"
    | "evaluations"
    | "studentAnsOcr"
    | "standardAnsOcr"
    | "questionOcr"
    | "status"
    | "error"
  > {}

class AIEvaluation extends Model<
  AIEvaluationAttributes,
  AIEvaluationCreationAttributes
> {
  public id!: number;
  public evaluationId!: string;
  public sheetId!: string;
  public studentId!: string;
  public examId!: string;
  public classId!: string;
  public section!: string;
  public subjectId!: string;
  public examType!: string;
  public totalScore!: number;
  public feedback!: string;
  public evaluations!: any;
  public studentAnsOcr!: string;
  public standardAnsOcr!: string;
  public questionOcr!: string;
  public status!: string;
  public error!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

AIEvaluation.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    evaluationId: { type: DataTypes.STRING, allowNull: false, unique: true },
    sheetId: { type: DataTypes.STRING, allowNull: false },
    studentId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    classId: { type: DataTypes.STRING, allowNull: false },
    section: { type: DataTypes.STRING, allowNull: false },
    subjectId: { type: DataTypes.STRING, allowNull: false },
    examType: { type: DataTypes.STRING, allowNull: false },
    totalScore: { type: DataTypes.FLOAT, allowNull: true },
    feedback: { type: DataTypes.TEXT, allowNull: true },
    evaluations: { type: DataTypes.JSONB, allowNull: true },
    studentAnsOcr: { type: DataTypes.TEXT, allowNull: true },
    standardAnsOcr: { type: DataTypes.TEXT, allowNull: true },
    questionOcr: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Pending",
    },
    error: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    tableName: "viaexam_ai_evaluations",
    modelName: "AIEvaluation",
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ["sheetId"],
        name: "unique_evaluation_per_sheet",
      },
      {
        fields: ["classId", "section", "subjectId", "examType"],
        name: "ai_evaluations_lookup_idx",
      },
    ],
  }
);

export default AIEvaluation;
