import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/sequelize";
import Heading from "./DynamicHeading.model"; // Assuming Heading is in the same directory
import DynamicModule from "./DynamicModule.model";

class DynamicField extends Model {
  public id!: number;
  public label!: string;
  public name!: string;
  public type!: string;
  public belongToSubTitle!: number | null;
  public editable!: boolean;
  public delete!: boolean;
  public fixed!: boolean;
  public isTableField!: boolean;
  public isView!: boolean;
  public belongToMaster!: string;
  public selectMaster!: string;
  public options!: Array<{ label: string; value: string }>;
  public isValidate!: boolean;
  public order!: number;
}

DynamicField.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    label: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    type: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    belongToSubTitle: {
      type: DataTypes.INTEGER,
      allowNull: true, // This can be null for fields that don't belong to a heading
    },
    editable: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    delete: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    fixed: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    isTableField: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    isView: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
    },
    belongToMaster: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    selectMaster: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    options: {
      type: DataTypes.JSONB, // Store options as JSON
      allowNull: true,
    },
    validation: {
      type: DataTypes.JSONB, // Store options as JSON
      allowNull: true,
    },
    isValidate: {
      type: DataTypes.BOOLEAN,
      defaultValue: true,
    },
    order: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: "dynamic_fields",
    modelName: "DynamicField",
    timestamps: true,
  }
);

// Associations
DynamicModule.hasMany(DynamicField, { foreignKey: "moduleId", as: "fields" }); // Fields can belong to a Heading
DynamicField.belongsTo(DynamicModule, { foreignKey: "moduleId", as: "fields" }); // A field can be part of a Heading or Module

export default DynamicField;
