
import {
  DataTypes,
  Model,
  Optional,
} from "sequelize";

import { sequelize } from "../../config/sequelize";

// ─────────────────────────────────────
// ATTRIBUTES
// ─────────────────────────────────────

export interface QuestionPaperAnswerAttributes {
  id: number;

  answerId: string;

  instituteId: string;

  paperId: string;

  examId: string;

  teacherId: string;

  paperSet: "A" | "B" | "C" | "D";

  answers: object;

  status:
    | "DRAFT"
    | "SUBMITTED"
    | "APPROVED"
    | "REJECTED";

  rejectionNote?: string | null;

  submittedAt?: Date | null;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}

// ─────────────────────────────────────

interface QuestionPaperAnswerCreationAttributes
  extends Optional<
    QuestionPaperAnswerAttributes,
    | "id"
    | "answerId"
    | "paperSet"
    | "status"
    | "rejectionNote"
    | "submittedAt"
    | "approvedAt"
    | "rejectedAt"
    | "createdAt"
    | "updatedAt"
    | "deletedAt"
  > {}

// ─────────────────────────────────────
// MODEL
// ─────────────────────────────────────

class QuestionPaperAnswer
  extends Model<
    QuestionPaperAnswerAttributes,
    QuestionPaperAnswerCreationAttributes
  >
  implements QuestionPaperAnswerAttributes
{
  public id!: number;

  public answerId!: string;

  public instituteId!: string;

  public paperId!: string;

  public examId!: string;

  public teacherId!: string;

  public paperSet!: "A" | "B" | "C" | "D";

  public answers!: object;

  public status!:
    | "DRAFT"
    | "SUBMITTED"
    | "APPROVED"
    | "REJECTED";

  public rejectionNote!: string | null;

  public submittedAt!: Date | null;
  public approvedAt!: Date | null;
  public rejectedAt!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public readonly deletedAt!: Date;
}

// ─────────────────────────────────────
// INIT
// ─────────────────────────────────────

QuestionPaperAnswer.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

    answerId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    instituteId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    paperId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    examId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    teacherId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    paperSet: {
      type: DataTypes.ENUM("A", "B", "C", "D"),
      allowNull: false,
      defaultValue: "A",
      field: "paper_set",
    },

    answers: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: {},
    },

    status: {
      type: DataTypes.ENUM(
        "DRAFT",
        "SUBMITTED",
        "APPROVED",
        "REJECTED"
      ),
      allowNull: false,
      defaultValue: "DRAFT",
    },

    rejectionNote: {
      type: DataTypes.TEXT,
      allowNull: true,
      defaultValue: null,
    },

    submittedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },

    approvedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },

    rejectedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,

    tableName: "viaexam_question_paper_answers",

    modelName: "QuestionPaperAnswer",

    timestamps: true,

    paranoid: true,

    indexes: [
      {
        fields: ["paperId"],
      },

      {
        fields: ["teacherId"],
      },

      {
        fields: ["status"],
      },

      {
        unique: true,
        fields: ["paperId", "paper_set"],
      },
    ],
  }
);

export default QuestionPaperAnswer;

