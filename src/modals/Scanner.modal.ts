import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

interface AnswerSheetAttributes {
  id: number;
  sheetId: string;
  instituteId: string;
  classId: string;
  section: string;
  subjectId: string;
  examType: string;
  examId?: string; // For approval workflow
  rollNo: string;
  studentName?: string; // For approval workflow
  fileName: string;
  fileBuffer: Buffer;
  fileMimeType: string;
  fileSize: number;
  status: string; // Pending, Evaluated, UPLOADED
  isDeleted: boolean;
  uploadedBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AnswerSheetCreationAttributes
  extends Optional<
    AnswerSheetAttributes,
    "id" | "sheetId" | "status" | "isDeleted"
  > {}

class Scanner extends Model<
  AnswerSheetAttributes,
  AnswerSheetCreationAttributes
> {
  public id!: number;
  public sheetId!: string;
  public instituteId!: string;
  public classId!: string;
  public section!: string;
  public subjectId!: string;
  public examType!: string;
  public examId?: string;
  public rollNo!: string;
  public studentName?: string;
  public fileName!: string;
  public fileBuffer!: Buffer;
  public fileMimeType!: string;
  public fileSize!: number;
  public status!: string;
  public isDeleted!: boolean;
  public uploadedBy!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Scanner.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sheetId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    classId: { type: DataTypes.STRING, allowNull: false },
    section: { type: DataTypes.STRING, allowNull: false },
    subjectId: { type: DataTypes.STRING, allowNull: false },
    examType: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: true }, // For approval workflow
    rollNo: { type: DataTypes.STRING, allowNull: false },
    studentName: { type: DataTypes.STRING, allowNull: true }, // For approval workflow
    fileName: { type: DataTypes.STRING, allowNull: false },
    fileBuffer: { type: DataTypes.BLOB("long"), allowNull: false },
    fileMimeType: { type: DataTypes.STRING, allowNull: false },
    fileSize: { type: DataTypes.INTEGER, allowNull: false },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Pending",
    },
    isDeleted: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    uploadedBy: { type: DataTypes.STRING, allowNull: false },
  },
  {
    sequelize,
    tableName: "viaexam_answer_sheets",
    modelName: "AnswerSheet",
    timestamps: true,
    indexes: [
      // Fast lookup: all sheets for a class+section+subject+exam combo
      {
        name: "viaexam_answer_sheets_institute_id_class_id_section_subject_id_",
        fields: ["instituteId", "classId", "section", "subjectId", "examType"],
      },
      // Index for approval workflow (viaexam_answer_sheets_exam_id_index)
      // exists in DB via migration — not declared here to avoid sync conflicts.
      // Unique sheet per student per exam
      {
        unique: true,
        fields: ["instituteId", "classId", "section", "subjectId", "examType", "rollNo"],
        where: { isDeleted: false }, // partial unique index
        name: "unique_sheet_per_student_per_exam",
      },
    ],
  }
);

export default Scanner;
