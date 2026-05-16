import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// ─────────────────────────────────────────────────────────────────
// Interfaces
// ─────────────────────────────────────────────────────────────────

interface QuestionPaperAttributes {
  id: number;
  paperId: string;
  examId: string;
  teacherId: string;
  instituteId: string;

  // Full JSON from the SetQuestionPaper component
  // Shape: { meta, sections, generalInstructions, questions[] }
  content: object;

  // Draft → Submitted → Approved
  //                  ↘ Rejected → (teacher revises) → Submitted
  status: "Draft" | "Submitted" | "Approved" | "Rejected";

  rejectionNote: string | null;  // set by examiner on rejection

  submittedAt: Date | null;
  approvedAt:  Date | null;
  rejectedAt:  Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

interface QuestionPaperCreationAttributes
  extends Optional<
    QuestionPaperAttributes,
    | "id"
    | "paperId"
    | "status"
    | "rejectionNote"
    | "submittedAt"
    | "approvedAt"
    | "rejectedAt"
  > {}

// ─────────────────────────────────────────────────────────────────
// Model
// ─────────────────────────────────────────────────────────────────

class QuestionPaper
  extends Model<QuestionPaperAttributes, QuestionPaperCreationAttributes>
  implements QuestionPaperAttributes
{
  public id!: number;
  public paperId!: string;
  public examId!: string;
  public teacherId!: string;
  public instituteId!: string;

  public content!: object;
  public status!: "Draft" | "Submitted" | "Approved" | "Rejected";
  public rejectionNote!: string | null;

  public submittedAt!: Date | null;
  public approvedAt!: Date | null;
  public rejectedAt!: Date | null;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

QuestionPaper.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    paperId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    examId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    teacherId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    instituteId: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    // Stored as JSON — Sequelize handles serialization automatically
    content: {
      type: DataTypes.JSON,
      allowNull: false,
    },

    status: {
      type: DataTypes.ENUM("Draft", "Submitted", "Approved", "Rejected"),
      allowNull: false,
      defaultValue: "Draft",
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

    indexes: [
      // One paper per exam per teacher
      { unique: true, fields: ["examId", "teacherId"], name: "uq_exam_teacher" },
      // Examiner queue — fast lookup by instituteId + status
      { fields: ["instituteId", "status"], name: "idx_qp_institute_status" },
      // Teacher's own papers
      { fields: ["teacherId", "status"], name: "idx_qp_teacher_status" },
    ],
  }
);

// ─────────────────────────────────────────────────────────────────
// Associations
// ─────────────────────────────────────────────────────────────────

// Paper belongs to the teacher (User) who wrote it
// QuestionPaper.belongsTo(User, {
//   foreignKey: "teacherId",
//   targetKey: "userId",
//   as: "teacher",
// });

// Paper belongs to the exam it was created for
// QuestionPaper.belongsTo(Exam, {
//   foreignKey: "examId",
//   targetKey: "examId",
//   as: "exam",
// });

// Exam can have one question paper
// Exam.hasOne(QuestionPaper, {
//   foreignKey: "examId",
//   sourceKey: "examId",
//   as: "questionPaper",
// });

export default QuestionPaper;