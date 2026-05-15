import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
import Class from "./Class.modal";
import User from "./User.modal";

interface SectionAttributes {
  id: number;
  sectionId: string;
  classId: string; // FK → Class
  instituteId: string; // FK → Institute
  sessionId: string; // FK → Session
  sectionName: string; // A, B, C, D
  classTeacherId: string | null; // FK → User (teacher)
  isActive: boolean;
  isDeleted: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SectionCreationAttributes
  extends Optional<
    SectionAttributes,
    "id" | "sectionId" | "classTeacherId" | "isActive" | "isDeleted"
  > {}

class Section
  extends Model<SectionAttributes, SectionCreationAttributes>
  implements SectionAttributes
{
  public id!: number;
  public sectionId!: string;
  public classId!: string;
  public instituteId!: string;
  public sessionId!: string;
  public sectionName!: string;
  public classTeacherId!: string | null;
  public isActive!: boolean;
  public isDeleted!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Section.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sectionId: { type: DataTypes.STRING, allowNull: false, unique: true },
    classId: { type: DataTypes.STRING, allowNull: false },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    sectionName: { type: DataTypes.STRING, allowNull: false },
    classTeacherId: {
      type: DataTypes.STRING,
      allowNull: true,
      defaultValue: null,
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    tableName: "viaexam_sections",
    modelName: "Section",
    timestamps: true,

    indexes: [
      {
        unique: true,
        fields: ["classId", "sectionName"],
      },
    ],
  },
);

// Section.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });

// Class.hasMany(Section, {
//   foreignKey: "classId",
//   sourceKey: "classId",
//   as: "sections",
// });


// Section belongs to Class
// Section.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });

// Section belongs to class teacher
// Section.belongsTo(User, {
//   foreignKey: "classTeacherId",
//   targetKey: "userId",
//   as: "classTeacher",
// });

export default Section;
