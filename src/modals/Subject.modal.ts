import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface SubjectAttributes {
  id:          number;
  subjectId:   string;
  classId:     string;   // FK → Class
  instituteId: string;
  subjectName: string;   // Mathematics, Science, English
  subjectCode: string | null;  // MAT001, SCI001
  teacherId:   string | null;  // FK → User (subject teacher)
  totalMarks:  number;
  passingMarks:number;
  isActive:    boolean;
  isDeleted:   boolean;
  createdAt?:  Date;
  updatedAt?:  Date;
}

interface SubjectCreationAttributes
  extends Optional<
    SubjectAttributes,
    | "id"
  | "subjectId"
  | "subjectCode"
  | "teacherId"
  | "isActive"
  | "isDeleted"
  > {}

class Subject
  extends Model<SubjectAttributes, SubjectCreationAttributes>
  implements SubjectAttributes
{
  public id!:           number;
  public subjectId!:    string;
  public classId!:      string;
  public instituteId!:  string;
  public subjectName!:  string;
  public subjectCode!:  string | null;
  public teacherId!:    string | null;
  public totalMarks!:   number;
  public passingMarks!: number;
  public isActive!:     boolean;
  public isDeleted!:    boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Subject.init(
  {
    id:           { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    subjectId:    { type: DataTypes.STRING,  allowNull: false, unique: true },
    classId:      { type: DataTypes.STRING,  allowNull: false },
    instituteId:  { type: DataTypes.STRING,  allowNull: false },
    subjectName:  { type: DataTypes.STRING,  allowNull: false },
    subjectCode:  { type: DataTypes.STRING,  allowNull: true, defaultValue: null,unique: true, },
    teacherId:    { type: DataTypes.STRING,  allowNull: true, defaultValue: null },
    totalMarks:   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    passingMarks: {type: DataTypes.INTEGER,allowNull: false,}, 
    isActive:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isDeleted:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  },
  {
    sequelize,
    tableName: "viaexam_subjects",
    modelName: "Subject",
    timestamps: true,
    indexes: [
  {
    unique: true,
    fields: ["classId",  "subjectName"],
  },
],
  }
);

// Subject.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });


// Subject.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });


// Subject.belongsTo(User, {
//   foreignKey: "teacherId",
//   targetKey: "userId",
//   as: "teacher",
// });

// Subject.hasMany(Exam, {
//   foreignKey: "subjectId",
//   sourceKey: "subjectId",
//   as: "exams",
// });

export default Subject;