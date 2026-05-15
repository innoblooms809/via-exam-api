import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface StudentProfileAttributes {
  id: number;
  userId: string;
  instituteId: string;
  classId: string | null;
  rollNumber: string;
  className: string;
  division: string;
  academicYear: string;
  fatherName: string;
  gender: string;
  dob: Date;
  aadhar: string;
  address: string;
  profileUrl: string | null;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface StudentProfileCreationAttributes
  extends Optional<
    StudentProfileAttributes,
    "id" | "profileUrl" | "isActive" | "classId"
  > {}

class StudentProfile
  extends Model<StudentProfileAttributes, StudentProfileCreationAttributes>
  implements StudentProfileAttributes
{
  public id!: number;
  public userId!: string;
  public instituteId!: string;
  public classId!: string | null;
  public rollNumber!: string;
  public className!: string;
  public division!: string;
  public academicYear!: string;
  public fatherName!: string;
  public gender!: string;
  public dob!: Date;
  public aadhar!: string;
  public address!: string;
  public profileUrl!: string | null;
  public isActive!: boolean;

  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StudentProfile.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },

    userId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,
    },

    instituteId: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    classId: {
      type: DataTypes.STRING,
      allowNull: true, // nullable for backward compatibility
      defaultValue: null,
      references: {
        model: "viaexam_classes",
        key: "classId",
      },
    },

    rollNumber: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    className: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    division: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    academicYear: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    fatherName: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    gender: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    dob: {
      type: DataTypes.DATE,
      allowNull: false,
    },

    aadhar: {
      type: DataTypes.STRING,
      allowNull: false,
    },

    address: {
      type: DataTypes.TEXT,
      allowNull: false,
    },

    profileUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },

    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    tableName: "viaexam_student_profiles",
    modelName: "StudentProfile",
    timestamps: true,
  },
);

export default StudentProfile;
