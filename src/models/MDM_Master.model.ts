import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
class Master extends Model {
  public masterId!: number;
  public masterName!: string;
  public isActive!: string;
  public createdBy!: number;
  public createdDate!: string;
  public data!: object; // Dynamic data stored in JSON format
}

Master.init(
  {
    masterId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
    },
    masterName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isActive: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    data: {
      type: DataTypes.JSONB, // JSONB to store dynamic fields
      allowNull: false,
    },
  },
  {
    sequelize,
    modelName: 'Master',
    tableName: 'master', // Table name in the database
    timestamps: true, // Automatically manage `createdAt` and `updatedAt`
  }
);

export default Master;