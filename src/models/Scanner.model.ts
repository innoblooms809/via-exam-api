import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
import { encryptedColumn } from "../utils/dataProtection";
import type { SheetQualityReport } from "../utils/sheetQuality";

interface AnswerSheetAttributes {
  id: number;
  sheetId: string;
  instituteId: string;
  classId: string;
  section: string;
  subjectId: string;
  examType: string;
  examId?: string; // For approval workflow
  /** The student's section (id) in the exam's session; `section` keeps the name for display. */
  sectionId?: string | null;
  /** Whose sheet it is. Roll numbers repeat across sections, so a sheet is matched by this. */
  studentId?: string | null;
  rollNo: string;
  studentName?: string; // For approval workflow
  fileName: string;
  /** Legacy: sheets uploaded before Cloudinary storage still carry their bytes here. */
  fileBuffer: Buffer | null;
  /** Cloudinary secure URL of the stored scan. Null only for legacy rows. */
  fileUrl: string | null;
  /** Cloudinary public id, needed to delete the asset when the sheet goes. */
  filePublicId: string | null;
  /** Cloudinary resource type ("raw" for PDFs, "image" otherwise). */
  fileResourceType: string | null;
  fileMimeType: string;
  fileSize: number;
  status: string; // Pending, Evaluated, UPLOADED
  /** Scan quality (utils/sheetQuality): ok, warn, low or unchecked; null until checked. */
  qualityFlag: string | null;
  /** Per-page DPI, sharpness and contrast behind qualityFlag (SheetQualityReport). */
  qualityReport: SheetQualityReport | null;
  isDeleted: boolean;
  uploadedBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AnswerSheetCreationAttributes
  extends Optional<
    AnswerSheetAttributes,
    | "id"
    | "sheetId"
    | "status"
    | "isDeleted"
    | "fileBuffer"
    | "fileUrl"
    | "filePublicId"
    | "fileResourceType"
    | "qualityFlag"
    | "qualityReport"
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
  public sectionId?: string | null;
  public studentId?: string | null;
  public rollNo!: string;
  public studentName?: string;
  public fileName!: string;
  public fileBuffer!: Buffer | null;
  public fileUrl!: string | null;
  public filePublicId!: string | null;
  public fileResourceType!: string | null;
  public fileMimeType!: string;
  public fileSize!: number;
  public status!: string;
  public qualityFlag!: string | null;
  public qualityReport!: SheetQualityReport | null;
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
    sectionId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    studentId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    rollNo: { type: DataTypes.STRING, allowNull: false },
    studentName: { type: DataTypes.STRING, allowNull: true }, // For approval workflow
    fileName: { type: DataTypes.STRING, allowNull: false },
    // Nullable since the move to Cloudinary: new rows store a URL instead.
    fileBuffer: { type: DataTypes.BLOB("long"), allowNull: true },
    // Encrypted at rest (utils/dataProtection): whoever has the link or the public id can fetch the scan.
    fileUrl: { type: DataTypes.TEXT, allowNull: true, ...encryptedColumn("fileUrl", "sheet.fileUrl") },
    filePublicId: { type: DataTypes.TEXT, allowNull: true, ...encryptedColumn("filePublicId", "sheet.filePublicId") },
    fileResourceType: { type: DataTypes.STRING, allowNull: true },
    fileMimeType: { type: DataTypes.STRING, allowNull: false },
    fileSize: { type: DataTypes.BIGINT, allowNull: false },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "Pending",
    },
    qualityFlag: { type: DataTypes.STRING(16), allowNull: true, defaultValue: null },
    qualityReport: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
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
      // One sheet per student per exam: a unique index on (examId, studentId), created in
      // db/sectionWorkBackfill. (The old class + section + roll key also caught next year's
      // sheet of the same roll, and two sections' roll 12 when the section was missing.)
    ],
  }
);

export default Scanner;
