import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface SectionAttributes {
  id: number;
  sectionId: string;
  classId: string; // FK → Class
  instituteId: string; // FK → Institute
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

// Section.belongsTo(Institute, {
//   foreignKey: "instituteId",
//   targetKey: "instituteId",
//   as: "institute",
// });

// Section.belongsTo(Class, {
//   foreignKey: "classId",
//   targetKey: "classId",
//   as: "class",
// });


// // Section belongs to class teacher
// Section.belongsTo(User, {
//   foreignKey: "classTeacherId",
//   targetKey: "userId",
//   as: "classTeacher",
// });

// Section.belongsTo(User, {
//   foreignKey: "classTeacherId",
//   targetKey: "userId",
//   as: "classTeacher",
// });

export default Section;
