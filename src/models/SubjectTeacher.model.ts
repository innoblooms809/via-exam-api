import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface SubjectTeacherAttributes {
  id: number;
  subjectId: string;
  teacherId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SubjectTeacherCreationAttributes
  extends Optional<SubjectTeacherAttributes, "id"> {}

class SubjectTeacher
  extends Model<SubjectTeacherAttributes, SubjectTeacherCreationAttributes>
  implements SubjectTeacherAttributes
{
  public id!: number;
  public subjectId!: string;
  public teacherId!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

SubjectTeacher.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subjectId: { type: DataTypes.STRING, allowNull: false },
    teacherId: { type: DataTypes.STRING, allowNull: false },
  },
  {
    sequelize,
    tableName: "viaexam_subject_teachers",
    modelName: "SubjectTeacher",
    timestamps: true,
  }
);

export default SubjectTeacher;
