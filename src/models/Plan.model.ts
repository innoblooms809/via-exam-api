import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// A subscription plan the super admin can edit (Basic / Pro / Enterprise).
// Prices are in the currency's minor unit (paise for INR), like Stripe.
interface PlanAttributes {
  id: number;
  planKey: string;
  name: string;
  description: string | null;
  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;
  trialDays: number;
  maxStudents: number | null; // null = unlimited
  maxTeachers: number | null; // null = unlimited
  features: string[];
  isPopular: boolean;
  isActive: boolean;
  sortOrder: number;
  updatedBy: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface PlanCreationAttributes
  extends Optional<
    PlanAttributes,
    | "id"
    | "description"
    | "trialDays"
    | "maxStudents"
    | "maxTeachers"
    | "features"
    | "isPopular"
    | "isActive"
    | "sortOrder"
    | "updatedBy"
  > {}

class Plan extends Model<PlanAttributes, PlanCreationAttributes> implements PlanAttributes {
  public id!: number;
  public planKey!: string;
  public name!: string;
  public description!: string | null;
  public monthlyPrice!: number;
  public yearlyPrice!: number;
  public currency!: string;
  public trialDays!: number;
  public maxStudents!: number | null;
  public maxTeachers!: number | null;
  public features!: string[];
  public isPopular!: boolean;
  public isActive!: boolean;
  public sortOrder!: number;
  public updatedBy!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Plan.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    planKey: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(60), allowNull: false },
    description: { type: DataTypes.STRING(300), allowNull: true, defaultValue: null },
    monthlyPrice: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    yearlyPrice: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    currency: { type: DataTypes.STRING(3), allowNull: false, defaultValue: "inr" },
    trialDays: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    maxStudents: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    maxTeachers: { type: DataTypes.INTEGER, allowNull: true, defaultValue: null },
    features: { type: DataTypes.JSONB, allowNull: false, defaultValue: [] },
    isPopular: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    updatedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_plans",
    modelName: "Plan",
    timestamps: true,
  }
);

export default Plan;
