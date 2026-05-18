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

// // Class belongs to Institute
// Class.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });

// // Class has one class teacher
// // Class.belongsTo(User, {
// //   foreignKey: "classTeacherId",
// //   targetKey: "userId",
// //   as: "classTeacher",
// // });

// // Class has many students
// // Class.hasMany(StudentProfile, {
// //   foreignKey: "classId",
// //   sourceKey: "classId",
// //   as: "students",
// // });

// // Class has many exams
// // Class.hasMany(Exam, {
// //   foreignKey: "classId",
// //   sourceKey: "classId",
// //   as: "exams",
// // });

// // Class.hasMany(Section, { foreignKey: "classId", sourceKey: "classId", as: "sections" });
// // Section.belongsTo(Class, { foreignKey: "classId", targetKey: "classId", as: "class" });


// // Class belongs to Session
// // Class.belongsTo(Session, {
// //   foreignKey: "sessionId",
// //   targetKey: "sessionId",
// //   as: "session",
// // });

// // Class has many Sections
// Class.hasMany(Section, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "sections",
// });

// // Class has many Subjects
// Class.hasMany(Subject, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "subjects",
// });

export default Class;
