import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
import { v4 as uuidv4 } from "uuid";

interface AcademicCalendarAttributes {
  id: number;
  eventId: string;
  title: string;
  description: string | null;
  eventDate: Date;
  startTime: string | null;
  endTime: string | null;
  eventType: string;
  color: string;
  instituteId: string;
  createdBy: string;
  isDeleted: boolean;
  sessionId: string | null;
  classId: string | null;
  className: string | null;
  subjectId: string | null;
  subjectName: string | null;
  duration: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AcademicCalendarCreationAttributes
  extends Optional<AcademicCalendarAttributes, "id" | "eventId" | "isDeleted" | "startTime" | "endTime" | "description" | "sessionId" | "classId" | "className" | "subjectId" | "subjectName" | "duration"> {}

class AcademicCalendar extends Model<AcademicCalendarAttributes, AcademicCalendarCreationAttributes> {
  public id!: number;
  public eventId!: string;
  public title!: string;
  public description!: string | null;
  public eventDate!: Date;
  public startTime!: string | null;
  public endTime!: string | null;
  public eventType!: string;
  public color!: string;
  public instituteId!: string;
  public createdBy!: string;
  public isDeleted!: boolean;
  public sessionId!: string | null;
  public classId!: string | null;
  public className!: string | null;
  public subjectId!: string | null;
  public subjectName!: string | null;
  public duration!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

AcademicCalendar.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    eventId: { 
      type: DataTypes.STRING, 
      allowNull: false, 
      unique: true, 
      defaultValue: () => `EVT-${uuidv4().substring(0, 8).toUpperCase()}` 
    },
    title: { type: DataTypes.STRING, allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    eventDate: { type: DataTypes.DATEONLY, allowNull: false },
    startTime: { type: DataTypes.STRING, allowNull: true },
    endTime: { type: DataTypes.STRING, allowNull: true },
    eventType: { type: DataTypes.STRING, allowNull: false },
    color: { type: DataTypes.STRING, allowNull: false },
    instituteId: { type: DataTypes.STRING, allowNull: false },
    createdBy: { type: DataTypes.STRING, allowNull: false },
    isDeleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sessionId: { type: DataTypes.STRING, allowNull: true },
    classId: { type: DataTypes.STRING, allowNull: true },
    className: { type: DataTypes.STRING, allowNull: true },
    subjectId: { type: DataTypes.STRING, allowNull: true },
    subjectName: { type: DataTypes.STRING, allowNull: true },
    duration: { type: DataTypes.STRING, allowNull: true }
  },
  {
    sequelize,
    tableName: "viaexam_academic_calendar",
    modelName: "AcademicCalendar",
    timestamps: true,
  }
);

export default AcademicCalendar;
