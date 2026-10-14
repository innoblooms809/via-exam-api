import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// A student's attendance for one exam, as recorded by the scanner.
// A student with an uploaded answer sheet is present by definition; this table
// records the ABSENT ones (no physical sheet). Un-marking flips the row back to
// PRESENT instead of deleting it, so who changed what stays on record.

export const ATTENDANCE_STATUS = { ABSENT: "ABSENT", PRESENT: "PRESENT" } as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUS)[keyof typeof ATTENDANCE_STATUS];

interface ExamAttendanceAttributes {
  id: number;
  attendanceId: string;
  instituteId: string;
  examId: string;
  studentId: string; // User.userId of the student
  rollNo: string;
  status: AttendanceStatus;
  markedBy: string;
  note: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface ExamAttendanceCreationAttributes extends Optional<ExamAttendanceAttributes, "id" | "note"> {}

class ExamAttendance
  extends Model<ExamAttendanceAttributes, ExamAttendanceCreationAttributes>
  implements ExamAttendanceAttributes
{
  public id!: number;
  public attendanceId!: string;
  public instituteId!: string;
  public examId!: string;
  public studentId!: string;
  public rollNo!: string;
  public status!: AttendanceStatus;
  public markedBy!: string;
  public note!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

ExamAttendance.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    attendanceId: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    examId: { type: DataTypes.STRING, allowNull: false },
    studentId: { type: DataTypes.STRING, allowNull: false },
    rollNo: { type: DataTypes.STRING(32), allowNull: false },
    status: {
      type: DataTypes.STRING(16),
      allowNull: false,
      validate: { isIn: [Object.values(ATTENDANCE_STATUS)] },
    },
    markedBy: { type: DataTypes.STRING, allowNull: false },
    note: { type: DataTypes.STRING(500), allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_exam_attendance",
    modelName: "ExamAttendance",
    timestamps: true,
    indexes: [
      { name: "viaexam_exam_attendance_exam_student", unique: true, fields: ["examId", "studentId"] },
      { name: "viaexam_exam_attendance_exam_status", fields: ["examId", "status"] },
    ],
  }
);

export default ExamAttendance;
