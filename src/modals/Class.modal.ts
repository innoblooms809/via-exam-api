import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface ClassAttributes {
  id: number;
  classId: string;
  instituteId: string; // FK → Institute
  className: string; // Class 1, Class 2 ... Class 12
  isActive: boolean;
  isDeleted?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ClassCreationAttributes
  extends Optional<ClassAttributes, "id" | "classId" | "isActive" | "isDeleted"> {}

class Class extends Model<ClassAttributes, ClassCreationAttributes> {
  public id!: number;
  public classId!: string;
  public instituteId!: string;
  public className!: string;
  public isActive!: boolean;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Class.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    classId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    instituteId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
     className: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "viaexam_classes",
    modelName: "Class",
    timestamps: true,
    indexes: [
      {
        // Unique: one section per class per year per institute
        unique: true,
        fields: ["instituteId", "className"],
      },
    ],
  },
);


export default Class;
