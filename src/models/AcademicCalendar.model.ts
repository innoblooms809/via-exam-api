import { DataTypes, Model, Optional } from "sequelize";
import { sequelize } from "../config/sequelize";
import { v4 as uuidv4 } from "uuid";

/**
 * A date-sheet paper starts as a draft (only the school admin sees it, and can change it
 * freely), until the admin publishes it; then teachers, scanner staff and students see it,
 * and a change of its date or time is a reschedule: with a reason, kept in changeLog, and
 * everyone concerned is told. Older rows and other events are "published".
 */
export type CalendarStatus = "draft" | "published";

/** Where a paper was before a change: shown to everyone as "rescheduled from …". */
export interface PaperSlot {
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  shift: string | null;
}

export interface CalendarChange {
  kind: "rescheduled" | "unscheduled";
  at: string;
  by: string;
  reason: string | null;
  from: PaperSlot;
  to?: PaperSlot;
}

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
  status: CalendarStatus;
  publishedAt: Date | null;
  publishedBy: string | null;
  changeLog: CalendarChange[] | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface AcademicCalendarCreationAttributes
  extends Optional<
    AcademicCalendarAttributes,
    | "id"
    | "eventId"
    | "isDeleted"
    | "startTime"
    | "endTime"
    | "description"
    | "sessionId"
    | "classId"
    | "className"
    | "subjectId"
    | "subjectName"
    | "duration"
    | "status"
    | "publishedAt"
    | "publishedBy"
    | "changeLog"
  > {}

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
  public status!: CalendarStatus;
  public publishedAt!: Date | null;
  public publishedBy!: string | null;
  public changeLog!: CalendarChange[] | null;
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
    duration: { type: DataTypes.STRING, allowNull: true },
    // "published" by default: older rows, and events other than date-sheet papers.
    status: { type: DataTypes.STRING(16), allowNull: false, defaultValue: "published" },
    publishedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    publishedBy: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
    changeLog: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
  },
  {
    sequelize,
    tableName: "viaexam_academic_calendar",
    modelName: "AcademicCalendar",
    timestamps: true,
  }
);

export default AcademicCalendar;
