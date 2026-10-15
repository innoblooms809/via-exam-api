import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Cross-checking: after an exam's evaluator confirms the marks, a second teacher checks the
// marks of chosen answer sheets before results are published (Master Data → Cross-checking
// sets which: every sheet, sheets by marks, or the ones the admin picks).
//
//   CrossCheckRound  one per exam at a time: the rule used, the cross-checker, open → done.
//   CrossCheckItem   one per chosen sheet: why it was chosen, its marks before, and the
//                    checker's outcome (confirmed, or changed with a reason).
// See services/exam/crossCheck.service.

export const CROSS_CHECK_REASON = {
  ALL: "all",
  BELOW: "below",
  ABOVE: "above",
  NEAR_PASS: "near-pass",
  PICKED: "picked",
} as const;
export type CrossCheckReason = (typeof CROSS_CHECK_REASON)[keyof typeof CROSS_CHECK_REASON];

export const CROSS_CHECK_ITEM_STATUS = { PENDING: "pending", CONFIRMED: "confirmed", CHANGED: "changed" } as const;
export type CrossCheckItemStatus = (typeof CROSS_CHECK_ITEM_STATUS)[keyof typeof CROSS_CHECK_ITEM_STATUS];

// ─── Round ────────────────────────────────────────────────────────────────────

interface CrossCheckRoundAttributes {
  id: number;
  roundId: string;
  instituteId: string;
  examId: string;
  /** all · rules · pick, as the school's rule was when the round started. */
  mode: string;
  /** The rule's numbers then: { below, above, nearPass }. */
  rule: { below: number | null; above: number | null; nearPass: number | null } | null;
  checkerId: string | null;
  assignedBy: string;
  /** open (sheets to check) · done (every sheet checked). */
  status: string;
  isActive: boolean;
  completedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CrossCheckRoundCreation extends Optional<CrossCheckRoundAttributes, "id" | "rule" | "checkerId" | "status" | "isActive" | "completedAt"> {}

export class CrossCheckRound extends Model<CrossCheckRoundAttributes, CrossCheckRoundCreation> implements CrossCheckRoundAttributes {
  public id!: number;
  public roundId!: string;
  public instituteId!: string;
  public examId!: string;
  public mode!: string;
  public rule!: { below: number | null; above: number | null; nearPass: number | null } | null;
  public checkerId!: string | null;
  public assignedBy!: string;
  public status!: string;
  public isActive!: boolean;
  public completedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

CrossCheckRound.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    roundId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    mode: { type: DataTypes.STRING(16), allowNull: false },
    rule: { type: DataTypes.JSONB, allowNull: true },
    checkerId: { type: DataTypes.STRING, allowNull: true },
    assignedBy: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "open" },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: "viaexam_cross_check_rounds",
    modelName: "CrossCheckRound",
    timestamps: true,
    indexes: [
      { name: "viaexam_cross_check_rounds_exam", fields: ["examId", "isActive"] },
      { name: "viaexam_cross_check_rounds_checker", fields: ["checkerId", "isActive"] },
    ],
  }
);

// ─── Item ─────────────────────────────────────────────────────────────────────

interface CrossCheckItemAttributes {
  id: number;
  itemId: string;
  roundId: string;
  instituteId: string;
  examId: string;
  sheetId: string;
  evaluationId: string | null;
  studentId: string | null;
  reason: CrossCheckReason;
  marksBefore: number | null;
  marksAfter: number | null;
  /** The checker's reason when the marks changed (or a remark). */
  note: string | null;
  status: CrossCheckItemStatus;
  checkedBy: string | null;
  checkedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface CrossCheckItemCreation
  extends Optional<CrossCheckItemAttributes, "id" | "evaluationId" | "studentId" | "marksBefore" | "marksAfter" | "note" | "status" | "checkedBy" | "checkedAt"> {}

export class CrossCheckItem extends Model<CrossCheckItemAttributes, CrossCheckItemCreation> implements CrossCheckItemAttributes {
  public id!: number;
  public itemId!: string;
  public roundId!: string;
  public instituteId!: string;
  public examId!: string;
  public sheetId!: string;
  public evaluationId!: string | null;
  public studentId!: string | null;
  public reason!: CrossCheckReason;
  public marksBefore!: number | null;
  public marksAfter!: number | null;
  public note!: string | null;
  public status!: CrossCheckItemStatus;
  public checkedBy!: string | null;
  public checkedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

const decimal = (field: string) => ({
  type: DataTypes.DECIMAL(8, 2),
  allowNull: true,
  // Postgres returns DECIMAL as a string.
  get(this: Model) {
    const v = this.getDataValue(field as any);
    return v === null || v === undefined ? null : Number(v);
  },
});

CrossCheckItem.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    itemId: { type: DataTypes.STRING, allowNull: false, unique: true },
    roundId: { type: DataTypes.STRING, allowNull: false },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    sheetId: { type: DataTypes.STRING, allowNull: false },
    evaluationId: { type: DataTypes.STRING, allowNull: true },
    studentId: { type: DataTypes.STRING, allowNull: true },
    reason: { type: DataTypes.STRING(16), allowNull: false },
    marksBefore: decimal("marksBefore"),
    marksAfter: decimal("marksAfter"),
    note: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "pending" },
    checkedBy: { type: DataTypes.STRING, allowNull: true },
    checkedAt: { type: DataTypes.DATE, allowNull: true },
  },
  {
    sequelize,
    tableName: "viaexam_cross_check_items",
    modelName: "CrossCheckItem",
    timestamps: true,
    indexes: [
      { name: "viaexam_cross_check_items_round", fields: ["roundId"] },
      { name: "viaexam_cross_check_items_sheet", fields: ["sheetId"] },
    ],
  }
);
