import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
import Subject from "./Subject.model";
import Exam from "./Exam.model";

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
  /** The question tree with totals (sub-parts, OR, attempt any N), as the evaluator returned it. */
  resultTree?: any;
  /** Evaluation queue: when the current run was queued / its OCR started / it ended. */
  queuedAt?: Date | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  /** Runs queued for this sheet (first evaluation, re-runs and automatic retries). */
  runCount?: number;
  /** Why the last run failed: "transient" (a service was down — retried automatically) or "permanent". */
  failureKind?: string | null;
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
    | "resultTree"
    | "queuedAt"
    | "startedAt"
    | "finishedAt"
    | "runCount"
    | "failureKind"
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
  public resultTree!: any;
  public queuedAt!: Date | null;
  public startedAt!: Date | null;
  public finishedAt!: Date | null;
  public runCount!: number;
  public failureKind!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // Associations
  public subject?: Subject;
  public exam?: Exam;
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
    resultTree: { type: DataTypes.JSONB, allowNull: true },
    queuedAt: { type: DataTypes.DATE, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    finishedAt: { type: DataTypes.DATE, allowNull: true },
    runCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    failureKind: { type: DataTypes.STRING(16), allowNull: true },
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
