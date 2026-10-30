import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";

// Where a student studies in one session: class, section and roll number.
//
// One row per student per session. Promotion adds next year's row and leaves this
// year's untouched, so an exam's roster, a class result sheet or a student's page for
// any past session always shows the class and roll number the student had then.
// isActive = false when the student left during (or before) that session; the row is
// kept for the record and frees the roll number.
//
// The student profile keeps a copy of the current row (classId, className, sectionId,
// session, rollNumber) for older screens; services/student/enrollment.service is the
// only writer of both.

interface StudentEnrollmentAttributes {
  id: number;
  enrollmentId: string;
  instituteId: string;
  /** User.userId of the student. */
  studentId: string;
  sessionId: string;
  classId: string;
  /** Always set for new rows; only history recovered from old results may lack it. */
  sectionId: string | null;
  rollNumber: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface StudentEnrollmentCreationAttributes extends Optional<StudentEnrollmentAttributes, "id" | "isActive"> {}

class StudentEnrollment extends Model<StudentEnrollmentAttributes, StudentEnrollmentCreationAttributes> implements StudentEnrollmentAttributes {
  public id!: number;
  public enrollmentId!: string;
  public instituteId!: string;
  public studentId!: string;
  public sessionId!: string;
  public classId!: string;
  public sectionId!: string | null;
  public rollNumber!: string;
  public isActive!: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

StudentEnrollment.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    enrollmentId: { type: DataTypes.STRING, allowNull: false, unique: true },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    studentId: { type: DataTypes.STRING, allowNull: false },
    sessionId: { type: DataTypes.STRING, allowNull: false },
    classId: { type: DataTypes.STRING, allowNull: false },
    sectionId: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    rollNumber: { type: DataTypes.STRING(32), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  },
  {
    sequelize,
    tableName: "viaexam_student_enrollments",
    modelName: "StudentEnrollment",
    timestamps: true,
    indexes: [
      { name: "viaexam_student_enrollments_student_session", unique: true, fields: ["studentId", "sessionId"] },
      // A roll number is used once per section per session, among students still there.
      { name: "viaexam_student_enrollments_section_roll", unique: true, fields: ["sessionId", "sectionId", "rollNumber"], where: { isActive: true } },
      { name: "viaexam_student_enrollments_roster", fields: ["instituteId", "sessionId", "classId", "sectionId"] },
    ],
  }
);

export default StudentEnrollment;
