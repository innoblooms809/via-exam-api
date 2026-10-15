import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// The discussion about an exam's question paper between the school's admins and its
// paper setter: the comments either side writes, and the steps of its approval (sent for
// approval, approved, sent back with the admin's note), so a paper's whole history reads
// in one place. Rows are only ever added.

export const PAPER_EVENT = {
  COMMENT: "comment",
  SUBMITTED: "submitted",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;
export type PaperEvent = (typeof PAPER_EVENT)[keyof typeof PAPER_EVENT];

interface PaperCommentAttributes {
  id: number;
  commentId: string;
  instituteId: string;
  examId: string;
  /** The set it is about (A–D), or null for the exam's paper as a whole. */
  paperSet: string | null;
  kind: PaperEvent;
  authorId: string;
  /** How the author took part: ADMIN or TEACHER. */
  authorRole: string;
  /** The comment, or the admin's note when a set is sent back. */
  body: string | null;
  createdAt?: Date;
}

interface PaperCommentCreationAttributes extends Optional<PaperCommentAttributes, "id" | "paperSet" | "body"> {}

class PaperComment extends Model<PaperCommentAttributes, PaperCommentCreationAttributes> implements PaperCommentAttributes {
  public id!: number;
  public commentId!: string;
  public instituteId!: string;
  public examId!: string;
  public paperSet!: string | null;
  public kind!: PaperEvent;
  public authorId!: string;
  public authorRole!: string;
  public body!: string | null;
  public readonly createdAt!: Date;
}

PaperComment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    commentId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    paperSet: { type: DataTypes.STRING(1), allowNull: true },
    kind: { type: DataTypes.STRING(16), allowNull: false },
    authorId: { type: DataTypes.STRING, allowNull: false },
    authorRole: { type: DataTypes.STRING(16), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    tableName: "viaexam_paper_comments",
    modelName: "PaperComment",
    timestamps: true,
    updatedAt: false,
    indexes: [{ name: "viaexam_paper_comments_exam", fields: ["examId", "id"] }],
  }
);

export default PaperComment;
