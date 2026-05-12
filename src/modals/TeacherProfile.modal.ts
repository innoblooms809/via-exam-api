// src/modals/TeacherProfile.modal.ts
import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface TeacherProfileAttributes {
  id: number;
  userId: string; // FK → User
  instituteId: string; // FK → Institute
  employeeID: string;
  teacherType: string;
  qualification: string;
  specialization: string | null;
  experience: string | null;
  joiningDate: Date;
  dob: Date;
  profileUrl: string | null;
  isExaminer: boolean;
  examinerSince: Date | null;
}

interface TeacherProfileCreationAttributes
  extends Optional<
    TeacherProfileAttributes,
    "id" | "specialization" | "experience" | "profileUrl"
  > {}

class TeacherProfile extends Model<
  TeacherProfileAttributes,
  TeacherProfileCreationAttributes
> {
  public id!: number;
  public userId!: string;
  public instituteId!: string;
  public employeeID!: string;
  public teacherType!: string;
  public qualification!: string;
  public specialization!: string | null;
  public experience!: string | null;
  public joiningDate!: Date;
  public dob!: Date;
  public profileUrl!: string | null;
  public isExaminer!: boolean;
  public examinerSince!: Date | null;
}

TeacherProfile.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    employeeID: { type: DataTypes.STRING, allowNull: false },
    teacherType: { type: DataTypes.STRING, allowNull: false },
    qualification: { type: DataTypes.STRING, allowNull: false },
    specialization: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    experience: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    joiningDate: { type: DataTypes.DATE, allowNull: false },
    dob: { type: DataTypes.DATE, allowNull: false },
    profileUrl: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    isExaminer: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    examinerSince: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: null,
    },
  },
  {
    sequelize,
    tableName: "viaexam_teacher_profiles",
    modelName: "TeacherProfile",
    timestamps: true,
  },
);

export default TeacherProfile;
