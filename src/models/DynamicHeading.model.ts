import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/sequelize";
import Module from "./DynamicModule.model"; // Assuming Module is in the same directory

class DynamicHeading extends Model {
  public id!: number;
  public heading!: string;
  public order!: number;
}

DynamicHeading.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull:false,
      primaryKey: true,
      autoIncrement: true,
    },
    heading: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    order:{
      type: DataTypes.INTEGER,
      allowNull: false,
    }
  },
  {
    sequelize,
    tableName: "dynamic_headings",
    modelName: "DynamicHeading",
    timestamps: true,
  }
);

// Associations
Module.hasMany(DynamicHeading, { foreignKey: "moduleId", as : "headings" });
DynamicHeading.belongsTo(Module, { foreignKey: "moduleId", as : "headings" });

export default DynamicHeading;
