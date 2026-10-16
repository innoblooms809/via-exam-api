import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// The school's own rules, one row per institute, set by its admin in Master Data:
//   gradingScale  grade bands for results and report cards (highest first)
//   marksDefaults the marks a subject starts with on Marks & grading, per exam
//   crossCheck    whether evaluated papers are cross-checked, and which ones
// Typed and validated in services/academic/instituteSettings.service; the JSON keeps
// the rules together without a table per rule.

export interface GradeBand {
  /** Lowest percentage for the grade (inclusive). */
  min: number;
  grade: string;
  remark?: string;
}

export interface MarksDefault {
  maxMarks: number;
  /** Pass mark as a percentage of the maximum. */
  passPercent: number;
}

export interface CrossCheckRule {
  /** off: no cross-check · all: every paper · rules: papers matching the bands below · pick: the admin picks. */
  mode: "off" | "all" | "rules" | "pick";
  /** rules: papers scoring below this percentage go for cross-check. */
  below: number | null;
  /** rules: papers scoring at or above this percentage go for cross-check. */
  above: number | null;
  /** rules: papers within this many marks of the pass mark (either side) go for cross-check. */
  nearPass: number | null;
  /** The subjects (Subject.subjectId) whose exams are cross-checked; null: every subject. */
  subjectIds: string[] | null;
}

interface InstituteSettingsAttributes {
  id: number;
  instituteId: string;
  gradingScale: GradeBand[] | null;
  marksDefaults: Record<string, MarksDefault> | null;
  crossCheck: CrossCheckRule | null;
  updatedBy: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface InstituteSettingsCreationAttributes
  extends Optional<InstituteSettingsAttributes, "id" | "gradingScale" | "marksDefaults" | "crossCheck" | "updatedBy"> {}

class InstituteSettings
  extends Model<InstituteSettingsAttributes, InstituteSettingsCreationAttributes>
  implements InstituteSettingsAttributes
{
  public id!: number;
  public instituteId!: string;
  public gradingScale!: GradeBand[] | null;
  public marksDefaults!: Record<string, MarksDefault> | null;
  public crossCheck!: CrossCheckRule | null;
  public updatedBy!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

InstituteSettings.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    instituteId: { type: DataTypes.STRING, allowNull: false, unique: true },
    gradingScale: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    marksDefaults: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    crossCheck: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    updatedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_institute_settings",
    modelName: "InstituteSettings",
    timestamps: true,
  }
);

export default InstituteSettings;
