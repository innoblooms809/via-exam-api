import { DataTypes, Model } from "sequelize";
import { sequelize } from "../config/sequelize"; // Assuming sequelize instance is configured

class DynamicModule extends Model {
  public id!: string;
  public moduleName!: string;
  public icon!: string;
  public no!: number;
  public deleted!: boolean;
}

DynamicModule.init(
  {
    id: {
      type: DataTypes.INTEGER(),
      allowNull: false,
      primaryKey: true,
      autoIncrement:true
    },
    moduleName: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    slug:{
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    icon: {
      type: DataTypes.STRING(255),
      allowNull: true,
    },
    no: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    deleted: {
      type: DataTypes.BOOLEAN,
      defaultValue: false,
    },
  },
  {
    sequelize,
    tableName: "dynamic_modules",
    modelName: "DynamicModule",
    timestamps: true,
  }
);

export default DynamicModule;
