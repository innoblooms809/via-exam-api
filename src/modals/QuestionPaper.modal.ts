import {
  DataTypes,
  Model,
  Optional,
} from "sequelize";

import { sequelize } from "../config/sequelize";
import User from "./User.modal";
import Exam from "./Exam.modal";

// ─────────────────────────────────────────────────────────────────
// Attributes
// ─────────────────────────────────────────────────────────────────

interface QuestionPaperAttributes {
  id: number;

  paperId: string;

  instituteId: string;   // ✅ ADDED

  examId: string;
  teacherId: string;

  paperSet: "A" | "B" | "C" | "D";

  content: object;

  status: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

  rejectionNote: string | null;

  submittedAt: Date | null;
  approvedAt: Date | null;
  rejectedAt: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}

// ─────────────────────────────────────────────────────────────────

interface QuestionPaperCreationAttributes
  extends Optional<
    QuestionPaperAttributes,
    | "id"
    | "paperId"
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

// ─────────────────────────────────────────────────────────────────
// Model Class
// ─────────────────────────────────────────────────────────────────

class QuestionPaper
  extends Model<
    QuestionPaperAttributes,
    QuestionPaperCreationAttributes
  >
  implements QuestionPaperAttributes
{
  public id!: number;

  public paperId!: string;

  public instituteId!: string; // ✅ ADDED

  public examId!: string;
  public teacherId!: string;

  public paperSet!: "A" | "B" | "C" | "D";

  public content!: object;

  public status!: "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

  public rejectionNote!: string | null;

  public submittedAt!: Date | null;
  public approvedAt!: Date | null;
  public rejectedAt!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  public readonly deletedAt!: Date;
}

// ─────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────

QuestionPaper.init(
  {
    id: {
      type: DataTypes.BIGINT,
      autoIncrement: true,
      primaryKey: true,
    },

     paperId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
      
    },


    instituteId: {
      type: DataTypes.STRING,
      allowNull: false,

      references: {
        model: "viaexam_institutes",
        key: "instituteId",
      },

      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    examId: {
      type: DataTypes.STRING,
      allowNull: false,

      references: {
        model: "viaexam_exams",
        key: "examId",
      },

      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    teacherId: {
      type: DataTypes.STRING,
      allowNull: false,

      references: {
        model: "viaexam_users",
        key: "userId",
      },

      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    },

    paperSet: {
      type: DataTypes.ENUM("A", "B", "C", "D"),
      allowNull: false,
      defaultValue: "A",
      field: "paper_set",
    },

    content: {
      type: DataTypes.JSONB,
      allowNull: false,

      validate: {
        notEmpty: true,
      },
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

    tableName: "viaexam_question_papers",

    modelName: "QuestionPaper",

    timestamps: true,

    paranoid: true,

    indexes: [
      {
        fields: ["instituteId"],
        name: "idx_qp_institute",
      },

      {
        fields: ["teacherId"],
        name: "idx_qp_teacher",
      },

      {
        fields: ["status"],
        name: "idx_qp_status",
      },

      {
        fields: ["examId", "status"],
        name: "idx_qp_exam_status",
      },
    ],
  }
);

// ─────────────────────────────────────────────────────────────────
// Associations
// ─────────────────────────────────────────────────────────────────

QuestionPaper.belongsTo(User, {
  foreignKey: "teacherId",
  targetKey: "userId",
  as: "teacher",
});

QuestionPaper.belongsTo(Exam, {
  foreignKey: "examId",
  targetKey: "examId",
  as: "exam",
});

Exam.hasMany(QuestionPaper, {
  foreignKey: "examId",
  sourceKey: "examId",
  as: "questionPapers",
});

export default QuestionPaper;
