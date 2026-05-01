import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize"; // Assuming you have an existing Sequelize instance

// Define the interface for the model attributes
export interface IPropertyAttributes {
  id: number;
  unitCode: string;
  unitDescription: string;
  projectName: string;
  unit: string;
  unitCategory: string;
  possessionStatus: string;
  propertyType: string;
  transactionType: string;
  ownership: string;
  reraRegisteredProperties: number;
  reraRegisteredPropertiesNumber?: string;
  furnishing: string;
  floors: number[];
  facing: string;
  bathroom: number[];
  balcony: number[];
  amenities: string;
  location: string;
  builtArea: string;
  superBuiltArea: string;
  captureArea: string;
  calculativeArea: string;
  finalizedArea: string;
  direction: string;
  createdBy: string;
  modifiedBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Optional attributes for when creating a new property (without an `id`)
export interface IPropertyCreationAttributes
  extends Optional<IPropertyAttributes, "id"> {}

// Define the Property model
export class Property
  extends Model<IPropertyAttributes, IPropertyCreationAttributes>
  implements IPropertyAttributes
{
  public id!: number;
  public unitCode!: string;
  public unitDescription!: string;
  public projectName!: string;
  public unit!: string;
  public unitCategory!: string;
  public possessionStatus!: string;
  public propertyType!: string;
  public transactionType!: string;
  public ownership!: string;
  public reraRegisteredProperties!: number;
  public reraRegisteredPropertiesNumber?: string;
  public furnishing!: string;
  public floors!: number[];
  public facing!: string;
  public bathroom!: number[];
  public balcony!: number[];
  public amenities!: string;
  public location!: string;
  public builtArea!: string;
  public superBuiltArea!: string;
  public captureArea!: string;
  public calculativeArea!: string;
  public finalizedArea!: string;
  public direction!: string;
  public createdBy!: string;
  public modifiedBy!: string;
  public createdAt!: Date;
  public updatedAt!: Date;
}

// Initialize the model
Property.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      // allowNull: true,
      autoIncrement:true
    },
    unitCode: {
      type: DataTypes.STRING,
      allowNull: false,
      primaryKey: true,
      unique: true,
    },
    unitDescription: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    projectName: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    unit: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    unitCategory: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    possessionStatus: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    propertyType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    transactionType: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    ownership: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    reraRegisteredProperties: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    reraRegisteredPropertiesNumber: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: "",
    },
    furnishing: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    floors: {
      type: DataTypes.JSONB, // Use JSONB to store arrays
      allowNull: false,
    },
    facing: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    bathroom: {
      type: DataTypes.JSONB, // Store arrays as JSON
      allowNull: false,
    },
    balcony: {
      type: DataTypes.JSONB, // Store arrays as JSON
      allowNull: false,
    },
    amenities: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    location: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    builtArea: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    superBuiltArea: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    captureArea: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    calculativeArea: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    finalizedArea: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    direction: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    createdBy: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    modifiedBy: {
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    sequelize, // Pass the sequelize instance
    tableName: "properties",
    timestamps: true, // Enable timestamps (createdAt, updatedAt)
  }
);

export default Property;
