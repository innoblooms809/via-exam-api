import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// How a school's printed documents look, one row per institute and kind of document:
//   result-sheet  the class result sheet (Results → Class results → PDF)
// Typed, validated and given defaults in services/academic/reportTemplate.service; the
// JSON keeps a template together without a column per option. Its own table (not a
// column on viaexam_institute_settings) so sync() creates it on boot and no deploy
// waits on a migration.

export const REPORT_KINDS = ["result-sheet"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

interface ReportTemplateAttributes {
  id: number;
  instituteId: string;
  kind: ReportKind;
  settings: Record<string, unknown>;
  updatedBy: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ReportTemplateCreationAttributes extends Optional<ReportTemplateAttributes, "id" | "settings" | "updatedBy"> {}

class ReportTemplate extends Model<ReportTemplateAttributes, ReportTemplateCreationAttributes> implements ReportTemplateAttributes {
  public id!: number;
  public instituteId!: string;
  public kind!: ReportKind;
  public settings!: Record<string, unknown>;
  public updatedBy!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ReportTemplate.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    kind: { type: DataTypes.STRING(40), allowNull: false },
    settings: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    updatedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_report_templates",
    modelName: "ReportTemplate",
    timestamps: true,
    indexes: [{ unique: true, fields: ["instituteId", "kind"], name: "viaexam_report_templates_institute_kind" }],
  }
);

export default ReportTemplate;
