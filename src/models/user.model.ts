import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize"; // Make sure you import the sequelize instance
import Access from "./Access.model";
import Role from "./Role.model";

// Define the interface for the User model (with all properties)
// Use Optional for fields that can be null (e.g., defaults or nullable fields)
interface UserAttributes {
  userId: string;
  password: string;
  companyName: string;
  siteLocation: string;
  userName: string;
  employeeCode: string;
  departmentId: number;
  departmentName: string;
  designationId: number;
  designationName: string;
  userTypeId: number;
  userTypeName: string;
  dateOfBirth: string;
  phoneNumber: string;
  emailId: string;
  aadharId: string;
  userPhoto: string;
  userSignature: string;
  status: number;
  roleId: number;
  createdAt?: Date;
  updatedAt?: Date;
}

// Define the type for creating a user (Optional will be used to handle defaults)
interface UserCreationAttributes
  extends Optional<UserAttributes, "userId" | "status"> {}

class UserModal extends Model {
  public userId!: string;
  public password!: string;
  public companyName!: string;
  public siteLocation!: string;
  public userName!: string;
  public employeeCode!: string;
  public departmentId!: number;
  public departmentName!: string;
  public designationId!: number;
  public designationName!: string;
  public userTypeId!: number;
  public userTypeName!: string;
  public dateOfBirth!: string;
  public phoneNumber!: string;
  public emailId!: string;
  public aadharId!: string;
  public userPhoto!: string;
  public userSignature!: string;
  public status!: number;
  public roleId!: number;

  // Define timestamps (createdAt, updatedAt) automatically added by Sequelize
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
  id: any;
}

UserModal.init(
  {
    id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true,
      autoIncrement: true,
    },
    userId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    password: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    companyName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    siteLocation: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    employeeCode: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    departmentId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    departmentName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    designationId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    designationName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userTypeId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    userTypeName: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    dateOfBirth: {
      type: DataTypes.STRING, // Consider changing to DATE type if you're dealing with actual date values
      allowNull: true,
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    emailId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },
    aadharId: {
      type: DataTypes.STRING,
      allowNull: true,
    },
    userPhoto: {
      type: DataTypes.STRING, // You might want to store this as a URL or file path
      allowNull: true,
    },
    userSignature: {
      type: DataTypes.STRING, // Same as userPhoto
      allowNull: true,
    },
    roleId: {
      type: DataTypes.INTEGER, // Same as userPhoto
      allowNull: false,
      // references: {
      //   model: Role, // Reference to the Role model
      //   key: 'roleId',
      // },
    },
    status: {
      type: DataTypes.INTEGER,
      allowNull: true,
      defaultValue: 1, // Default status is 1
    },
  },
  {
    sequelize, // The sequelize instance imported from your configuration
    tableName: "users", // Name of the table in the database
    modelName: "UserModal", // Sequelize model name
    timestamps: true, // Automatically adds createdAt and updatedAt
  }
);
// UserModal.hasMany(Access, { foreignKey: 'roleId', as: 'permissions' })
UserModal.belongsTo(Role, { foreignKey: "roleId", as: "role" });
export default UserModal;

